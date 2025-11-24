// encoder.js
export default class Encoder {
    // --- Vector Encoding ---
    static encodeVector(vec) {
        // vec = {x, y}
        return [Number(vec.x.toFixed(2)), Number(vec.y.toFixed(2))];
    }

    static decodeVector(data) {
        if (!Array.isArray(data) || data.length < 2) return { x: 0, y: 0 };
        return { x: parseFloat(data[0]), y: parseFloat(data[1]) };
    }

    // --- Bitboard Encoding ---
    // board = array of 0/1 values, size = fixed (e.g., 10x20 grid)
    static encodeBitboard(board) {
        // Pack bits into a base64 string for compact transport
        const bits = board.flat().join("");
        const bytes = bits.match(/.{1,8}/g).map(b => parseInt(b.padEnd(8, "0"), 2));
        return btoa(String.fromCharCode(...bytes));
    }

    static decodeBitboard(encoded, width, height) {
        const binary = atob(encoded)
            .split("")
            .map(c => c.charCodeAt(0).toString(2).padStart(8, "0"))
            .join("")
            .slice(0, width * height)
            .split("")
            .map(bit => parseInt(bit, 10));
        const board = [];
        for (let y = 0; y < height; y++) {
            board.push(binary.slice(y * width, (y + 1) * width));
        }
        return board;
    }

    // --- NumberBoard Encoding ---
    // Similar to Bitboard, but stores small integers (e.g., health, power)
    static encodeNumberBoard(board, maxVal = 15) {
        const flat = board.flat();
        const bitsPerNum = Math.ceil(Math.log2(maxVal + 1));
        let bitString = "";
        flat.forEach(num => {
            const clamped = Math.max(0, Math.min(num, maxVal));
            bitString += clamped.toString(2).padStart(bitsPerNum, "0");
        });

        const bytes = bitString.match(/.{1,8}/g).map(b => parseInt(b.padEnd(8, "0"), 2));
        return btoa(String.fromCharCode(...bytes));
    }

    static decodeNumberBoard(encoded, width, height, maxVal = 15) {
        const bitsPerNum = Math.ceil(Math.log2(maxVal + 1));
        const binary = atob(encoded)
            .split("")
            .map(c => c.charCodeAt(0).toString(2).padStart(8, "0"))
            .join("");
        const values = [];
        for (let i = 0; i < width * height; i++) {
            const bitSeg = binary.slice(i * bitsPerNum, (i + 1) * bitsPerNum);
            values.push(parseInt(bitSeg, 2) || 0);
        }
        const board = [];
        for (let y = 0; y < height; y++) {
            board.push(values.slice(y * width, (y + 1) * width));
        }
        return board;
    }

    // --- Single Number / String Encoding ---
    static encodeNumber(num, precision = 3) {
        return Number(num.toFixed(precision));
    }

    static decodeNumber(val) {
        return parseFloat(val) || 0;
    }

    static encodeString(str) {
        return encodeURIComponent(str);
    }

    static decodeString(encoded) {
        return decodeURIComponent(encoded);
    }

    // --- Utility: diff two number arrays / boards ---
    static diffBoards(oldBoard, newBoard) {
        const diff = [];
        const height = Math.min(oldBoard.length, newBoard.length);
        const width = Math.min(oldBoard[0].length, newBoard[0].length);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (oldBoard[y][x] !== newBoard[y][x]) {
                    diff.push([x, y, newBoard[y][x]]);
                }
            }
        }
        return diff;
    }

    static applyDiff(board, diff) {
        diff.forEach(([x, y, val]) => {
            if (board[y] && board[y][x] !== undefined) {
                board[y][x] = val;
            }
        });
        return board;
    }
}
