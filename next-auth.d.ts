import NextAuth, { DefaultSession, DefaultUser } from "next-auth";
import { JWT, DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  /**
   * Returned by \`useSession\`, \`getSession\` and received as a prop on the \`SessionProvider\` React Context
   */
  interface Session {
    user: {
      /** The user's GitHub username. */
      username?: string | null;
      /** The user's GitHub ID. */
      id?: string | null;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    username?: string | null;
  }
}

declare module "next-auth/jwt" {
  /** Returned by the \`jwt\` callback and sent to the \`session\` callback. */
  interface JWT extends DefaultJWT {
    /** The user's GitHub username. */
    username?: string | null;
    /** The user's GitHub ID. */
    id?: string | null;
  }
}
