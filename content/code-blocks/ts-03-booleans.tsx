/*= =============== Booleans ================ */
let isLoading: boolean = false;

let inferredIsLoading = false;
// inferredIsLoading: boolean

const isDone = true;
// isDone: true

// Typescript is aware of your entire environment
// and infers values whenever possible.

const maybeDone = !isLoading && isDone;
// maybeDone: infers to true

let notAString = !"Super!";
// notAString: boolean

const emptyString = !!"";
// emptyString: false
