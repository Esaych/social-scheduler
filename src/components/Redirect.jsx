import Error from "./Error";

const Redirect = ({ error, children }) => {
  if (error) {
    return <Error error={error} />;
  }
  return children;
};

export default Redirect;
