import * as fs from "fs";

export const JSONParse = (object: string, origin = ""): unknown => {
  try {
    return JSON.parse(object);
  } catch (err) {
    console.log(err instanceof Error ? err.message : err);
    fs.writeFileSync(`json-error-${Date.now()}.json`, object);
    // console.log({ origin, object });
    return {};
  }
};
