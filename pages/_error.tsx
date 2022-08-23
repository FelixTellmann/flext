import { useRouter } from "next/router";

export const Error = (props) => {
  const router = useRouter();
  console.log(router);
  console.log(props);
  return <>Error</>;
};

Error.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  console.log(res.statusCode);
  return { statusCode };
};

export default Error;
