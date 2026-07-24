export const serializeFormWithGroups = (formElement: HTMLFormElement) => {
  const obj: Record<string, FormDataEntryValue[]> = {};
  const formData = new FormData(formElement);
  for (const key of formData.keys()) {
    obj[key] = formData.getAll(key);
  }
  return obj;
};

export const serializeForm = (formElement: HTMLFormElement) => {
  const obj: Record<string, FormDataEntryValue> = {};
  const formData = new FormData(formElement);
  for (const key of formData.keys()) {
    // key comes from formData.keys(), so get(key) can never be null
    obj[key] = formData.get(key)!;
  }
  return obj;
};
