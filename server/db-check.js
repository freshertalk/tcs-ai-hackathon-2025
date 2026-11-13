"use strict";
// Checks the MongoDB connection the server will use:   npm run db:check
// Reads MONGO_URI / MONGO_DB from the environment or server/.env, connects, writes and reads
// back one small record, and lists what the server has stored. It never prints the address.

const { loadEnv } = require("./env");
loadEnv();

async function main() {
  if (!process.env.MONGO_URI) {
    console.log("MONGO_URI is not set (in the environment or server/.env): the server will keep its records in files under server/data/.");
    return;
  }
  const { MongoClient } = require("mongodb");
  const dbName = process.env.MONGO_DB || "stock-trading";
  const client = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000, appName: "vinaytiwari-desk-check" });
  try {
    await client.connect();
    const db = client.db(dbName);
    const at = new Date();
    await db.collection("docs").updateOne({ _id: "_check" }, { $set: { v: { ok: true }, at } }, { upsert: true });
    const back = await db.collection("docs").findOne({ _id: "_check" });
    await db.collection("docs").deleteOne({ _id: "_check" });
    const names = (await db.collection("docs").find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
    const logs = await db.collection("logs").countDocuments({});
    console.log(`Connected to database "${dbName}". Write and read back: ${back && back.v && back.v.ok ? "OK" : "FAILED"}.`);
    console.log(names.length ? `Stored records: ${names.join(", ")}. Log entries: ${logs}.` : "No records yet: the first server start imports them from server/data/.");
  } catch (err) {
    console.error(`Could not use MongoDB: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
}

main();
