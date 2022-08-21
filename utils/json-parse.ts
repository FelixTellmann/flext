import * as fs from "fs";

export const JSONParse = (object: any, origin = "") => {
  try {
    return JSON.parse(object);
  } catch (err) {
    console.log(err.message);
    fs.writeFileSync(`json-error-${Date.now()}.json`, object);
    // console.log({ origin, object });
    return {};
  }
};
