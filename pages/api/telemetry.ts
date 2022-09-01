import type { NextApiRequest, NextApiResponse } from "next";

type TelemetryData = {
  name?: string;
};

type TelemetryFunction = (
  req: NextApiRequest,
  res: NextApiResponse<TelemetryData>
) => Promise<void>;

export const Telemetry: TelemetryFunction = async (req, res) => {
  console.log(req.body);
  // console.log(req.headers);
  const data = await fetch("https://flext-analytics.vercel.app/api/collect", {
    headers: {
      "User-Agent": req.headers["user-agent"] as string,
    },
    method: "POST",
    body: req.body,
  });

  console.log({ data });
  res.status(200).json({ name: "John Doe" });
};

export default Telemetry;
