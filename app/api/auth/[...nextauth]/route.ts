/* eslint-disable @typescript-eslint/no-explicit-any */
import NextAuth, { AuthOptions, Profile, Session } from 'next-auth';
import GithubProvider from 'next-auth/providers/github';
import { JWT } from 'next-auth/jwt';
import { getAuthSecret } from '@/lib/auth/secret';

if (!process.env.GITHUB_ID || !process.env.GITHUB_SECRET) {
  console.warn(
    'WARNING: GITHUB_ID and GITHUB_SECRET environment variables are not set. Authentication will fail.'
  );
}

if (process.env.NODE_ENV === 'production' && !process.env.NEXTAUTH_SECRET) {
  console.warn('WARNING: NEXTAUTH_SECRET is not set in production.');
}

export const authOptions: AuthOptions = {
  secret: getAuthSecret(),
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID || '',
      clientSecret: process.env.GITHUB_SECRET || '',
      authorization: {
        params: { scope: 'read:user user:email repo' },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, profile, account }: { token: JWT; account?: any; profile?: Profile }) {
      if (profile) {
        token.username = (profile as any).login ?? token.username ?? null;
        token.image = (profile as any).avatar_url ?? token.image;
        token.id = (profile as any).id != null ? String((profile as any).id) : token.id ?? null;
      }
      if (account?.access_token) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (session.user) {
        session.user.username = token.username ?? null;
        if (typeof token.image === 'string') {
          session.user.image = token.image;
        }
        session.user.id = token.id ?? null;
      }
      return session;
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
