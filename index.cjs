// src/index.cjs
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const {
  Options,
  WebpayPlus,
  IntegrationCommerceCodes,
  IntegrationApiKeys,
  Environment,
} = require("transbank-sdk");
const { Resend } = require("resend");

dotenv.config();

const app = express();

// 🛡️ MIDDLEWARE DE SEGURIDAD
app.use(helmet({
  contentSecurityPolicy: false, // Permitir contenido externo para desarrollo
}));

// 📊 RATE LIMITING GENERAL
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por IP
  message: {
    error: "Too many requests from this IP, please try again later.",
    retryAfter: "15 minutes"
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// 🚨 RATE LIMITING ESTRICTO PARA TRANSACCIONES
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // máximo 10 transacciones por IP cada 15 min
  message: {
    error: "Too many transaction attempts, please try again later.",
    retryAfter: "15 minutes"
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 🌐 CORS CONFIGURADO
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 📝 MIDDLEWARE DE LOGGING
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const userAgent = req.get('User-Agent') || 'Unknown';
  const ip = req.ip || req.connection.remoteAddress || 'Unknown';
  
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${ip} - UA: ${userAgent.substring(0, 50)}`);
  next();
});

// 📧 CONFIGURACIÓN DE RESEND
const resend = new Resend(process.env.RESEND_API_KEY || "re_XkCapUu8_K88UuY86Z47YHevg3irjfBwt");

// 💳 CONFIGURACIÓN DE TRANSBANK
const tx = new WebpayPlus.Transaction(
  new Options(
    IntegrationCommerceCodes.WEBPAY_PLUS,
    IntegrationApiKeys.WEBPAY,
    Environment.Integration
  )
);

// 🗄️ ALMACENAMIENTO TEMPORAL MEJORADO
const transactionData = {};

// 🧹 LIMPIEZA AUTOMÁTICA DE DATOS TEMPORALES
setInterval(() => {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  let cleanedCount = 0;
  
  Object.keys(transactionData).forEach(token => {
    const data = transactionData[token];
    if (data.createdAt && new Date(data.createdAt) < thirtyMinutesAgo) {
      delete transactionData[token];
      cleanedCount++;
    }
  });
  
  if (cleanedCount > 0) {
    console.log(`[${new Date().toISOString()}] Cleaned up ${cleanedCount} expired transaction records`);
  }
}, 30 * 60 * 1000); // Ejecutar cada 30 minutos

// 🏥 HEALTH CHECK ENDPOINT
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    activeTransactions: Object.keys(transactionData).length,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.1.0'
  });
});

// 💰 ENDPOINT CREAR TRANSACCIÓN MEJORADO
app.post("/api/create-transaction", strictLimiter, async (req, res) => {
  try {
    const { amount, customerInfo, cartItems, subtotal, discount, couponCode } = req.body;
    
    // 🔍 VALIDACIONES MEJORADAS
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ 
        error: "Invalid amount", 
        details: "Amount must be a positive number" 
      });
    }
    
    if (!customerInfo || !customerInfo.firstName || !customerInfo.email) {
      return res.status(400).json({ 
        error: "Customer information is required",
        details: "firstName and email are mandatory fields" 
      });
    }
    
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({ 
        error: "Cart items are required",
        details: "At least one item must be in the cart" 
      });
    }

    // 📧 VALIDAR EMAIL FORMAT
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerInfo.email)) {
      return res.status(400).json({ 
        error: "Invalid email format",
        details: "Please provide a valid email address" 
      });
    }

    // 🏷️ VALIDAR DESCUENTO SI EXISTE
    if (discount && discount > amount) {
      return res.status(400).json({ 
        error: "Invalid discount",
        details: "Discount cannot be greater than the total amount" 
      });
    }

    const buyOrder = `LUX-${Date.now()}`;
    const sessionId = `SESSION-${Date.now()}`;
    const returnUrl = process.env.FRONTEND_URL 
      ? `${process.env.FRONTEND_URL}/checkout/confirm`
      : "http://localhost:5173/checkout/confirm";

    console.log("🔄 Creating transaction with:", {
      buyOrder,
      sessionId,
      amount,
      returnUrl,
      customerInfo: {
        firstName: customerInfo.firstName,
        email: customerInfo.email.substring(0, 3) + '***', // Email parcial por seguridad
        phone: customerInfo.phone || 'Not provided'
      },
      cartItemsCount: cartItems.length,
      subtotal: subtotal || 'Not provided',
      discount: discount || 0,
      couponCode: couponCode || 'None'
    });

    const response = await tx.create(buyOrder, sessionId, amount, returnUrl);
    console.log("✅ Transbank response:", {
      token: response.token ? '***' + response.token.slice(-8) : 'No token',
      url: response.url ? 'URL received' : 'No URL'
    });

    // 💾 ALMACENAR DATOS COMPLETOS
    transactionData[response.token] = { 
      customerInfo,
      cartItems,
      subtotal: subtotal || cartItems.reduce((total, item) => 
        total + (parseInt(item.vehicle.price) * item.quantity), 0
      ),
      discount: discount || 0,
      couponCode: couponCode || null,
      createdAt: new Date().toISOString(),
      buyOrder,
      sessionId
    };

    if (response.url) {
      res.json({ 
        success: true,
        url: response.url, 
        token: response.token,
        buyOrder,
        message: "Transaction created successfully"
      });
    } else {
      throw new Error("No redirection URL received from Webpay");
    }
  } catch (error) {
    console.error("❌ Error creating transaction:", {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    res.status(500).json({ 
      error: "Error creating transaction",
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// ✅ ENDPOINT CONFIRMAR TRANSACCIÓN MEJORADO
app.post("/api/confirm-transaction", strictLimiter, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ 
        error: "Token is required",
        details: "Transaction token must be provided" 
      });
    }

    // 🔍 VERIFICAR QUE EL TOKEN EXISTE
    const storedData = transactionData[token];
    if (!storedData) {
      console.warn(`⚠️  Transaction data not found for token: ***${token.slice(-8)}`);
      return res.status(404).json({ 
        error: "Transaction data not found",
        details: "The transaction may have expired or is invalid" 
      });
    }

    console.log(`🔄 Confirming transaction for token: ***${token.slice(-8)}`);

    // 💳 CONFIRMAR CON TRANSBANK
    const response = await tx.commit(token);
    console.log("✅ Transaction commit response:", {
      status: response.status,
      buyOrder: response.buy_order,
      amount: response.amount,
      authCode: response.authorization_code
    });

    // 📦 RECUPERAR DATOS ALMACENADOS
    const { customerInfo, cartItems, subtotal, discount, couponCode, buyOrder } = storedData;

    // 📄 RESPUESTA COMPLETA
    const fullResponse = {
      success: true,
      status: response.status,
      orderId: response.buy_order || buyOrder,
      amount: response.amount,
      subtotal: subtotal,
      discount: discount,
      couponCode: couponCode,
      cardLast4Digits: response.card_detail?.card_number || 'N/A',
      customerInfo,
      cartItems,
      transactionDate: new Date().toISOString(),
      // 📊 INFORMACIÓN ADICIONAL DE TRANSBANK
      authorizationCode: response.authorization_code,
      responseCode: response.response_code,
      paymentType: response.payment_type_code,
      installments: response.installments_number || 1
    };

    // 🧹 LIMPIAR DATOS TEMPORALES
    delete transactionData[token];
    console.log(`🗑️  Cleaned transaction data for token: ***${token.slice(-8)}`);

    res.json(fullResponse);
  } catch (error) {
    console.error("❌ Error confirming transaction:", {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    res.status(500).json({ 
      error: "Error confirming transaction",
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

// 📧 ENDPOINT ENVIAR EMAIL MEJORADO
app.post("/api/send-email", async (req, res) => {
  try {
    const { to, subject, reactTemplate } = req.body;

    console.log(`📧 Received email request:`, {
      to: to ? to.substring(0, 3) + '***@' + to.split('@')[1] : 'No email',
      subject: subject ? subject.substring(0, 30) + '...' : 'No subject',
      templateLength: reactTemplate ? reactTemplate.length : 0,
      timestamp: new Date().toISOString()
    });

    // 🔍 VALIDACIONES
    if (!to || !subject || !reactTemplate) {
      console.warn(`❌ Missing required fields:`, {
        to: !!to,
        subject: !!subject,
        reactTemplate: !!reactTemplate
      });
      return res.status(400).json({ 
        error: "Missing required fields",
        details: "to, subject, and reactTemplate are required" 
      });
    }

    // 📧 VALIDAR EMAIL FORMAT
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      console.warn(`❌ Invalid email format: ${to}`);
      return res.status(400).json({ 
        error: "Invalid email format",
        details: "Please provide a valid email address" 
      });
    }

    // 📏 VALIDAR TAMAÑO DEL TEMPLATE
    if (reactTemplate.length > 500000) { // 500KB limit
      console.warn(`❌ Email template too large: ${reactTemplate.length} bytes`);
      return res.status(400).json({ 
        error: "Email template too large",
        details: "Template must be less than 500KB" 
      });
    }

    console.log(`📧 Sending email to: ${to.substring(0, 3)}***@${to.split('@')[1]}`);

    // 🔑 VERIFICAR CONFIGURACIÓN DE RESEND
    const apiKey = process.env.RESEND_API_KEY;
    console.log(`🔑 Resend API Key configured: ${apiKey ? 'Yes' : 'No'} (${apiKey ? apiKey.substring(0, 8) + '***' : 'N/A'})`);

    const emailResponse = await resend.emails.send({
      from: process.env.EMAIL_FROM || "Luxury Cars <onboarding@resend.dev>",
      to: [to],
      subject: subject,
      html: reactTemplate,
      headers: {
        'X-Priority': '1',
        'X-MSMail-Priority': 'High',
        'Importance': 'high',
        'X-Mailer': 'Luxury Cars System v1.1.0'
      },
      tags: [
        {
          name: 'category',
          value: 'transaction-confirmation'
        }
      ]
    });

    console.log("✅ Email sent successfully:", {
      id: emailResponse.id || 'No ID received',
      to: to.substring(0, 3) + '***@' + to.split('@')[1],
      subject: subject.substring(0, 30) + '...',
      responseData: emailResponse
    });

    res.status(200).json({
      success: true,
      emailId: emailResponse.id,
      message: "Email sent successfully",
      timestamp: new Date().toISOString(),
      debugInfo: {
        resendResponse: emailResponse,
        apiKeyConfigured: !!apiKey
      }
    });
  } catch (error) {
    console.error("❌ Error sending email:", {
      message: error.message,
      name: error.name,
      stack: error.stack,
      to: req.body.to ? req.body.to.substring(0, 3) + '***' : 'Unknown',
      apiKey: process.env.RESEND_API_KEY ? 'Configured' : 'Not configured'
    });
    
    res.status(500).json({ 
      error: "Error sending email",
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString(),
      debugInfo: process.env.NODE_ENV === 'development' ? {
        errorName: error.name,
        apiKeyConfigured: !!process.env.RESEND_API_KEY
      } : undefined
    });
  }
});

// 🚫 MANEJO DE RUTAS NO ENCONTRADAS
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    availableEndpoints: [
      'GET /api/health',
      'POST /api/create-transaction',
      'POST /api/confirm-transaction',
      'POST /api/send-email'
    ],
    timestamp: new Date().toISOString()
  });
});

// 🚨 MANEJO GLOBAL DE ERRORES
app.use((error, req, res, next) => {
  console.error('💥 Unhandled error:', {
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    url: req.url,
    method: req.method
  });

  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// 🚀 INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`
🚀 ====================================
   LUXURY CARS BACKEND STARTED
🚀 ====================================
🌍 Server running on port: ${PORT}
🔧 Environment: ${process.env.NODE_ENV || 'development'}
🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}
📧 Email service: ${process.env.RESEND_API_KEY ? 'Configured' : 'Using default key'}
⏰ Started at: ${new Date().toISOString()}
🛡️  Security features: Rate limiting, CORS, Helmet
🧹 Auto-cleanup: Every 30 minutes
====================================
  `);
});

// 🔄 GRACEFUL SHUTDOWN
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🔄 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// 🚨 MANEJO DE PROMESAS RECHAZADAS
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});