import Encoder from "./Encoder.js";
import Signal from "../Signal.js";

export default class Serializer {
	constructor() {
		this.previousStates = new Map();

		// --- Signals ---
		this.signals = {
			onEncode: new Signal(),
			onDecode: new Signal(),
			onDiff: new Signal(),
			onApply: new Signal(),
			onClear: new Signal()
		};
	}

	/**
	 * Encodes data (auto-type detection) and emits signal.
	 */
	encode(data, key = null) {
		if (data == null) return null;

		let encoded;

		if (typeof data === "number") {
			encoded = Encoder.encodeNumber(data);
		} else if (typeof data === "string") {
			encoded = Encoder.encodeString(data);
		} else if (Array.isArray(data)) {
			if (data.length && typeof data[0] === "number") {
				encoded = data.map(n => Encoder.encodeNumber(n));
			} else if (Array.isArray(data[0])) {
				const numeric = data.flat().every(n => typeof n === "number" && n >= 0 && n <= 255);
				if (numeric) encoded = Encoder.encodeNumberBoard(data);
				else encoded = Encoder.encodeBitboard(data.map(r => r.map(v => (v ? 1 : 0))));
			} else {
				encoded = data.map(v => this.encode(v));
			}
		} else if (typeof data === "object" && "x" in data && "y" in data) {
			encoded = Encoder.encodeVector(data);
		} else if (typeof data === "object") {
			encoded = {};
			for (const [k, v] of Object.entries(data)) {
				encoded[k] = this.encode(v, k);
			}
		} else {
			encoded = data;
		}

		if (key) this.previousStates.set(key, encoded);

		this.signals.onEncode.emit({ key, encoded, original: data });
		return encoded;
	}

	/**
	 * Decodes data recursively and emits signal.
	 */
	decode(encoded) {
		if (encoded == null) return null;

		let decoded;

		if (Array.isArray(encoded)) {
			if (encoded.length === 2 && encoded.every(v => typeof v === "number")) {
				decoded = Encoder.decodeVector(encoded);
			} else {
				decoded = encoded.map(v => this.decode(v));
			}
		} else if (typeof encoded === "string") {
			try {
				decoded = Encoder.decodeString(encoded);
			} catch {
				decoded = encoded;
			}
		} else if (typeof encoded === "object") {
			decoded = {};
			for (const [k, v] of Object.entries(encoded)) {
				decoded[k] = this.decode(v);
			}
		} else {
			decoded = encoded;
		}

		this.signals.onDecode.emit({ encoded, decoded });
		return decoded;
	}

	/**
	 * Compare two data objects and return minimal diff.
	 */
	diff(key, currentData) {
		const prev = this.previousStates.get(key);
		const currentEncoded = this.encode(currentData, key);

		if (!prev) {
			this.signals.onDiff.emit({ key, full: true, data: currentEncoded });
			return { full: true, data: currentEncoded };
		}

		const diff = {};
		let changed = false;

		for (const k in currentEncoded) {
			if (JSON.stringify(currentEncoded[k]) !== JSON.stringify(prev[k])) {
				diff[k] = currentEncoded[k];
				changed = true;
			}
		}

		if (changed) {
			this.signals.onDiff.emit({ key, full: false, data: diff });
			return { full: false, data: diff };
		}
		return null;
	}

	/**
	 * Merges remote update into local target, emits signal.
	 */
	apply(target, update) {
		for (const [k, v] of Object.entries(update)) {
			if (Array.isArray(v) || typeof v !== "object") {
				target[k] = v;
			} else {
				target[k] = target[k] || {};
				this.apply(target[k], v);
			}
		}

		this.signals.onApply.emit({ target, update });
	}

	clear() {
		this.previousStates.clear();
		this.signals.onClear.emit();
	}
}

