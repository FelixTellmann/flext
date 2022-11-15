import type { NextApiRequest, NextApiResponse } from "next";

type TypeformWebhookData = {
  name?: string;
};

type TypeformWebhookFunction = (
  req: NextApiRequest,
  res: NextApiResponse<TypeformWebhookData>
) => Promise<void>;

export const TypeformWebhook: TypeformWebhookFunction = async (req, res) => {
  console.log(req.body);
  console.log(JSON.stringify(req.body));
  res.status(200).json({ name: "John Doe" });
};

export default TypeformWebhook;
