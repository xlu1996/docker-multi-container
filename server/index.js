const keys = require("./keys");

// Express App Setup
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Postgres Client Setup
const { Pool } = require("pg");

const pgClient = new Pool({
  user: keys.pgUser,
  host: keys.pgHost,
  database: keys.pgDatabase,
  password: keys.pgPassword,
  port: keys.pgPort,
  connectionTimeoutMillis: 10000,
});

pgClient.on("error", (err) => console.log("Lost PG connection:", err.message));

// 等待 Postgres 准备好
const connectWithRetry = async () => {
  const maxRetries = 10;
  for (let i = 0; i < maxRetries; i++) {
    try {
      await pgClient.query("SELECT 1");
      console.log("✅ Connected to Postgres");
      await pgClient.query("CREATE TABLE IF NOT EXISTS values (number INT)");
      console.log("✅ Table ready");
      return;
    } catch (err) {
      console.log(`⏳ Waiting for Postgres... (${i + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error("Could not connect to Postgres");
};

connectWithRetry().catch((err) => {
  console.error("❌ Failed to connect:", err);
  process.exit(1);
});

// Redis Client Setup
const redis = require("redis");
const redisClient = redis.createClient({
  host: keys.redisHost,
  port: keys.redisPort,
  retry_strategy: () => 1000,
});
const redisPublisher = redisClient.duplicate();

// Express route handlers

app.get("/", (req, res) => {
  res.send("Hi");
});

app.get("/values/all", async (req, res) => {
  try {
    const values = await pgClient.query("SELECT * from values");
    console.log(values);
    res.send(values.rows);
  } catch (err) {
    console.log("Error querying postgres:", err);
    res.status(500).send({ error: "Database query failed" });
  }
});

app.get("/values/current", async (req, res) => {
  redisClient.hgetall("values", (err, values) => {
    if (err) {
      return res.status(500).send(err);
    }
    res.send(values || {});
  });
});

app.post("/values", async (req, res) => {
  const index = req.body.index;

  if (parseInt(index) > 40) {
    return res.status(422).send("Index too high");
  }

  redisClient.hset("values", index, "Nothing yet!");
  redisPublisher.publish("insert", index);
  pgClient.query("INSERT INTO values(number) VALUES($1)", [index]);

  res.send({ working: true });
});

app.listen(5000, (err) => {
  console.log("Listening");
});
