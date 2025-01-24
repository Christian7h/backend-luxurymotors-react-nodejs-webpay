// src/index.cjs
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
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
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "https://rpmlegends.netlify.app",
  })
);
app.use(express.json());
const resend = new Resend("re_XkCapUu8_K88UuY86Z47YHevg3irjfBwt");


// Configura la transacción con el entorno adecuado de integración
const tx = new WebpayPlus.Transaction(
  new Options(
    IntegrationCommerceCodes.WEBPAY_PLUS,
    IntegrationApiKeys.WEBPAY,
    Environment.Integration
  )
);

// Almacenamiento temporal para customerInfo (en un entorno real, usa una base de datos)
const transactionData = {};

app.post("/api/create-transaction", async (req, res) => {
  try {
    const { amount, customerInfo,cartItems } = req.body;
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    const buyOrder = Date.now().toString();
    const sessionId = Date.now().toString();
    const returnUrl = "https://rpmlegends.netlify.app/checkout/confirm"; // URL de retorno http://localhost:5173

    console.log("Creating transaction with:", {
      buyOrder,
      sessionId,
      amount,
      returnUrl,
      customerInfo,
      cartItems
    });

    const response = await tx.create(buyOrder, sessionId, amount, returnUrl);
    console.log("Transbank response:", response);

    // Almacena customerInfo temporalmente usando el token como clave
    transactionData[response.token] = { customerInfo,cartItems };

    if (response.url) {
      // Devuelve la URL y el token de Webpay
      res.json({ url: response.url, token: response.token });
    } else {
      throw new Error("No redirection URL received from Webpay");
    }
  } catch (error) {
    console.error("Error creating transaction:", error.message);
    res.status(500).json({ error: "Error creating transaction" });
  }
});

app.post("/api/confirm-transaction", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    // Confirma la transacción con Transbank
    const response = await tx.commit(token);
    console.log("Transaction commit response:", response);

    // Recupera customerInfo almacenado temporalmente
    const { customerInfo,cartItems } = transactionData[token] || {};

    res.json({
      status: response.status, // 'AUTHORIZED', 'FAILED', etc.
      orderId: response.buy_order, // Identificador único de la orden
      amount: response.amount,
      cardLast4Digits: response.card_detail.card_number,
      customerInfo, // Devuelve los datos del formulario
      cartItems
    });
  } catch (error) {
    console.error("Error confirming transaction:", error.message);
    res.status(500).json({ error: "Error confirming transaction" });
  }
});

app.post("/api/send-email", async (req, res) => {
  try {
    const { to, subject, reactTemplate } = req.body;

    if (!to || !subject || !reactTemplate) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const response = await resend.emails.send({
      from: "Acme <onboarding@resend.dev>",
      to: [to],
      subject: subject,
      html: reactTemplate,
    });

    console.log("Email sent successfully:", response);
    res.status(200).json(response);
  } catch (error) {
    console.error("Error sending email:", error.message);
    res.status(500).json({ error: "Error sending email" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on portT ${PORT}`);
});