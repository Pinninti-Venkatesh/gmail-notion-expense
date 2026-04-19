import { queryOllama } from './ollama-client.js';
import logger from '../utils/logger.js';

const VALID_CATEGORIES = [
  'Food', 'Groceries', 'Shopping', 'Travel', 'Entertainment',
  'Bills', 'Health', 'Education', 'Electronics', 'Fuel',
  'Rent', 'Insurance', 'Subscriptions', 'General',
];

export async function analyzeTransactionEmail(sender, subject, body) {
  const prompt = `You are a financial email analyzer. Analyze this email and determine if it is a bank/financial transaction alert (credit card, debit card, or UPI payment notification).

EMAIL DETAILS:
From: ${sender}
Subject: ${subject}
Body:
${body.substring(0, 1500)}

Respond ONLY with a JSON object. If this is a transaction alert, respond with:
{
  "isTransaction": true,
  "amount": <number>,
  "merchant": "<merchant name, cleaned up>",
  "bank": "<bank name>",
  "cardLast4": "<last 4 digits if available, else null>",
  "paymentType": "<Credit Card | Debit Card | UPI | Net Banking>"
}

If this is NOT a transaction alert (e.g. promotional email, OTP, statement, reward points), respond with:
{
  "isTransaction": false
}

Rules:
- Amount must be a number without commas (e.g. 1500.50, not 1,500.50)
- Merchant name should be clean and readable (e.g. "Swiggy" not "SWIGGY MUMBAI IN")
- Bank name should be short (e.g. "HDFC", "ICICI", "SBI", "Axis", "Kotak")
- Only mark as transaction if there is a clear spend/debit. Ignore refunds, cashback, OTPs, bill reminders.
- For cardLast4: look for patterns like "XX1234", "ending 1234", "card **1234". Extract just the 4 digits as a string. If not found, use null.
- For merchant: remove city names and country codes (e.g. "ZEPTO CITYNAME" should be "Zepto", "AMAZON PAY INDIA" should be "Amazon Pay"). Also remove "UPI_" prefix from merchant names (e.g. "UPI_MERCHANTNAME" should be "Merchantname").
- For paymentType: determine based on what the email says the instrument is, NOT the merchant name. If the email says "Credit Card", it is "Credit Card" even if the merchant has "UPI_" prefix (UPI is just the payment rail, the instrument is still a credit card). Only use "UPI" if the email explicitly mentions a bank account or UPI ID being debited, not a card.`;

  try {
    const result = await queryOllama(prompt);
    if (!result.isTransaction) return null;

    // Validate required fields
    if (!result.amount || !result.merchant) {
      logger.warn('LLM extracted transaction but missing required fields', result);
      return null;
    }

    // Fallback: extract card last 4 from body with regex if LLM missed it
    let cardLast4 = (result.cardLast4 && result.cardLast4 !== 'null') ? result.cardLast4 : null;
    if (!cardLast4) {
      const cardMatch = body.match(/(?:XX|xx|ending\s*(?:with\s*)?|card\s*\*{0,4})(\d{4})/i);
      if (cardMatch) cardLast4 = cardMatch[1];
    }

    return {
      amount: typeof result.amount === 'string' ? parseFloat(result.amount.replace(/,/g, '')) : result.amount,
      merchant: result.merchant.trim(),
      bank: result.bank || 'Unknown',
      cardLast4,
      paymentType: result.paymentType || 'Credit Card',
    };
  } catch (err) {
    logger.error('LLM transaction analysis failed', err.message);
    return null;
  }
}

export async function categorizeTransaction(merchant, description) {
  const prompt = `You are an expense categorizer. Given a merchant name and optional purchase description, pick the single best category.

Merchant: ${merchant}
${description ? `Purchase details: ${description}` : ''}

Available categories: ${VALID_CATEGORIES.join(', ')}

Rules:
- "Groceries" is for grocery/daily essentials orders (BigBasket, Blinkit, Zepto groceries, DMart)
- "Food" is for restaurant orders and food delivery (Swiggy restaurant, Zomato restaurant, dining out)
- "Shopping" is for general retail (Amazon, Flipkart, Myntra, clothing, etc.)
- "Electronics" is for gadgets, tech accessories, phones
- "Subscriptions" is for recurring digital services (Netflix, Spotify, YouTube Premium)
- "Bills" is for utilities, recharges, bill payments
- If the description mentions specific items, use those to decide (e.g. Amazon order for books → Education)
- If unsure, use "General"

Respond with ONLY a JSON object:
{
  "category": "<category name>"
}`;

  try {
    const result = await queryOllama(prompt);
    const category = result.category?.trim();
    if (category && VALID_CATEGORIES.includes(category)) return category;
    return 'General';
  } catch (err) {
    logger.error('LLM categorization failed', err.message);
    return 'General';
  }
}

export async function summarizeOrderEmail(body) {
  const prompt = `You are reading a purchase confirmation or order receipt email. Summarize what was ordered in a brief, readable format.

EMAIL BODY:
${body.substring(0, 2000)}

Rules:
- List the items purchased concisely (e.g. "Milk (2), Bread, Eggs (12-pack), Bananas")
- If it's a food delivery, list the dishes (e.g. "Butter Chicken, Naan (2), Dal Makhani")
- If it's a single product, describe it briefly (e.g. "Sony WH-1000XM5 Headphones - Black")
- If it's a cab/ride, mention pickup and drop if available (e.g. "Ride: City Centre to Airport")
- Keep it under 150 characters
- If you cannot determine what was ordered, respond with "N/A"

Respond with ONLY a JSON object:
{
  "description": "<concise summary>"
}`;

  try {
    const result = await queryOllama(prompt);
    const desc = result.description?.trim();
    if (!desc || desc === 'N/A') return null;
    return desc;
  } catch (err) {
    logger.error('LLM order summarization failed', err.message);
    return null;
  }
}