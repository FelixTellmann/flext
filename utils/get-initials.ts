export const getInitials = (name: string) => {
  return name
    .match(/(\w+[^\w]*)/gi)
    ?.map((match) => {
      return match.charAt(0).toUpperCase();
    })
    .join("");
};
