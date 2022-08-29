export const serializeFormWithGroups = (formElement) => {
  const obj = {};
  const formData = new FormData(formElement);
  for (const key of formData.keys()) {
    obj[key] = formData.getAll(key);
  }
  return obj as { [T: string]: string[] };
};

export const serializeForm = (formElement) => {
  const obj = {};
  const formData = new FormData(formElement);
  for (const key of formData.keys()) {
    obj[key] = formData.get(key);
  }
  return obj as { [T: string]: string[] };
};
