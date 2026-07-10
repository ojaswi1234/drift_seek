/* eslint-disable @typescript-eslint/no-explicit-any */
import NextAuth, { AuthOptions, Profile, Session } from "next-auth"
import GithubProvider from "next-auth/providers/github"
import CredentialsProvider from "next-auth/providers/credentials"
import { JWT } from "next-auth/jwt";

export const authOptions: AuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID || "dummy-github-id",
      clientSecret: process.env.GITHUB_SECRET || "dummy-github-secret",
      authorization: { 
        params: { scope: 'read:user user:email repo workflow' } 
      },
    }),
    CredentialsProvider({
      id: "credentials",
      name: "Guest Sandbox",
      credentials: {
        username: { label: "Username", type: "text", placeholder: "guest_user" }
      },
      async authorize(credentials) {
        const username = credentials?.username || "guest_user";
        return {
          id: "guest-id",
          name: username,
          email: `${username}@driftseek.local`,
          image: "https://avatar.iran.liara.run/public/3"
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, profile, account, user }: { token: JWT; account?: any; profile?: Profile; user?: any }) {
      if (user) {
        token.username = user.name;
        token.image = user.image;
        token.id = user.id;
        token.accessToken = "mock-guest-access-token";
      }
      if (profile) {
        token.username = (profile as any).login;
        token.image = (profile as any).avatar_url;
        token.id = (profile as any).id;
      }
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (session.user) {
        (session.user as any).username = token.username;
        (session.user as any).image = token.image;
        (session.user as any).id = token.id;
      }
      (session as any).accessToken = token.accessToken;
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
