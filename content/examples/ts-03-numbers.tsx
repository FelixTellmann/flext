/*= =============== Numbers ================ */
let integer: number = 6;
let float: number = 12.4
let hex: number = 0xf00d;
let binary: number = 0b1010;
let octal: number = 0o344;
let big: bigint = 100n;
let notANumber: number = NaN;

let inferredNumber = 6;
// inferredNumber: number

let inferredFloat = 12.4
// inferredFloat: number

let inferredHex = 0xf00d;
// inferredHex: number

let inferredBinary = 0b1010;
// inferredBinary: number

let inferredOctal = 0o744;
// inferredOctal: number

let inferredBig = 100n;
// inferredBig: bigint

let inferredNaN = NaN;
// inferredBig: number

const inferredConstant = 12
// inferredConstant: 12
