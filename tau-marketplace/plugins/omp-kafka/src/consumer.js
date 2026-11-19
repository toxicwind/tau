/**
 * Per-consumer runtime: wraps a KafkaJS Consumer with a bounded ring
 * buffer, pause/resume, reconnect, and a tiny text-decode helper.
 *
 * The buffer is in-memory only. Offsets are committed by KafkaJS in the
 * background so a restart resumes from the last committed offset.
 *
 * Reconnect behavior: `reload()` is the only path that fully tears down
 * the underlying consumer. `pause()`/`resume()` are cooperative and do
 * not touch the network.
 */
import { Kafka, logLevel } from "kafkajs";
export class ManagedConsumer {
    cfg;
    listeners = new Set();
    buffer = [];
    kafka = null;
    consumer = null;
    status = { state: "idle" };
    dropped = 0;
    constructor(cfg) {
        this.cfg = cfg;
    }
    get name() {
        return this.cfg.name;
    }
    get config() {
        return this.cfg;
    }
    get currentStatus() {
        return this.status;
    }
    get bufferDepth() {
        return this.buffer.length;
    }
    get droppedCount() {
        return this.dropped;
    }
    onMessage(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /** Snapshot the last `limit` records (most recent last). */
    tail(limit, since) {
        const out = [];
        const sinceMs = since ? Date.parse(since) : Number.NaN;
        // Iterate in reverse to surface the most recent records first. The
        // loop bound `i >= 0` plus `i < buffer.length` already constrains
        // the index, so we capture `r` once instead of asserting twice.
        for (let i = this.buffer.length - 1; i >= 0 && out.length < limit; i--) {
            const r = this.buffer[i];
            if (r === undefined)
                continue;
            if (!Number.isNaN(sinceMs) && Date.parse(r.timestamp) < sinceMs)
                continue;
            out.unshift(r);
        }
        return out;
    }
    clear() {
        this.buffer.length = 0;
        this.dropped = 0;
    }
    async connect() {
        if (this.consumer)
            return;
        this.status = { state: "connecting" };
        const baseKafkaConfig = {
            clientId: this.cfg.clientId,
            brokers: this.cfg.brokers,
            logLevel: logLevel.NOTHING,
            ...this.cfg.clientConfig,
        };
        const sasl = this.cfg.sasl
            ? {
                mechanism: this.cfg.sasl.mechanism,
                username: this.cfg.sasl.username,
                password: this.cfg.sasl.password,
            }
            : undefined;
        const kafkaConfig = {
            ...baseKafkaConfig,
            ...(this.cfg.ssl ? { ssl: true } : {}),
            ...(sasl ? { sasl } : {}),
        };
        const kafka = new Kafka(kafkaConfig);
        const consumer = kafka.consumer({
            groupId: this.cfg.groupId,
            sessionTimeout: 30000,
            heartbeatInterval: 3000,
        });
        this.kafka = kafka;
        this.consumer = consumer;
        try {
            await consumer.connect();
            await consumer.subscribe({
                topics: this.cfg.topics,
                fromBeginning: this.cfg.fromBeginning,
            });
            await consumer.run({
                eachMessage: async ({ topic, partition, message }) => {
                    const record = this.toRecord(topic, partition, message);
                    this.push(record);
                    for (const fn of this.listeners) {
                        try {
                            fn(record);
                        }
                        catch {
                            // listener errors must not stop the consumer loop
                        }
                    }
                },
            });
            this.status = { state: "running", since: Date.now() };
        }
        catch (err) {
            this.status = {
                state: "error",
                error: err.message,
                since: Date.now(),
            };
            // Best-effort cleanup so a future reload() starts fresh.
            try {
                await consumer.disconnect();
            }
            catch {
                /* ignore */
            }
            this.consumer = null;
            this.kafka = null;
            throw err;
        }
    }
    async pause() {
        if (!this.consumer || this.status.state !== "running")
            return;
        const topics = this.cfg.topics.map(t => ({ topic: t }));
        this.consumer.pause(topics);
        this.status = { state: "paused", since: Date.now() };
    }
    async resume() {
        if (!this.consumer || this.status.state !== "paused")
            return;
        const topics = this.cfg.topics.map(t => ({ topic: t }));
        this.consumer.resume(topics);
        this.status = { state: "running", since: Date.now() };
    }
    async disconnect() {
        const c = this.consumer;
        this.consumer = null;
        this.kafka = null;
        this.status = { state: "disconnected" };
        if (!c)
            return;
        try {
            await c.disconnect();
        }
        catch {
            /* swallow: shutdown path is best-effort */
        }
    }
    async reload() {
        await this.disconnect();
        await this.connect();
    }
    push(record) {
        this.buffer.push(record);
        const overflow = this.buffer.length - this.cfg.maxQueue;
        if (overflow > 0) {
            this.buffer.splice(0, overflow);
            this.dropped += overflow;
        }
    }
    toRecord(topic, partition, message) {
        const headers = {};
        for (const [k, v] of Object.entries(message.headers ?? {})) {
            if (v === undefined)
                continue;
            headers[k] = Buffer.isBuffer(v) ? v.toString("utf8") : String(v);
        }
        return {
            consumer: this.cfg.name,
            topic,
            partition,
            offset: message.offset,
            key: message.key ? message.key.toString("utf8") : null,
            value: message.value ? message.value.toString("utf8") : "",
            headers,
            timestamp: message.timestamp,
        };
    }
}
