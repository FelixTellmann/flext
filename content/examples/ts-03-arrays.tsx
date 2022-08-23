/*= =============== Arrays ================ */
let numbers: number[] = [1, 2, 3];
let moreNumbers: Array<number> = [1, 2, 3];

let inferredNumbers = [1, 2, 3];
// inferredNumbers: number[]

// Unlike `string`, `number`, or `boolean` types,
// TypeScript will not infer to the specific value
// when using the `const` keyword.

const inferredTypesArray = ["string", "boolean", "number"]
// inferredTypesArray: string[]

// You can use the `as const` keyword to specify types
const inferredConstTypesArray = ["string", "boolean", "number"] as const
// inferredConstTypesArray: readonly ["string", "boolean", "number"]

// This will prevent any further Array manipulations
// and make the Array immutable
inferredConstTypesArray.push("object")
/* Err: Property 'push' does not exist on type 'readonly ["string", "boolean", "number"]' */
