import { createContext, useContext } from "react";

// { loading, error, configured, needsSetup, user, reload }
export const AuthContext = createContext({ loading: true });
export const useAuth = () => useContext(AuthContext);
