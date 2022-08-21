export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`;
}

function convertString(name, str) {
  const arr = [];

  str
    .replace(/#(......)/gi, "$#$1|")
    .replace(/(\s|\n)/gi, "")
    .split("|")
    .forEach((color) => {
      const [val, col] = color.split("$");
      if (!col) return;
      arr.push(`--color-${name}-${val}: ${hexToRgb(col)};`);
    });

  console.log(arr.join("\n"));
  return arr.join("\n");
}
