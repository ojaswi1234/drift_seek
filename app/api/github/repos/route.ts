/* eslint-disable @typescript-eslint/no-explicit-any */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route"; 
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || !(session as any).accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // If mock/guest access token, return fallback mock repos
  if ((session as any).accessToken === "mock-guest-access-token") {
    return NextResponse.json([
      {
        id: 1,
        name: "drift_seek_sandbox",
        owner: { login: "guest_dev" },
        html_url: "https://github.com/guest_dev/drift_seek_sandbox",
        private: false,
        stargazers_count: 42,
        forks_count: 7,
      },
      {
        id: 2,
        name: "microservices-uptime-monitor",
        owner: { login: "guest_dev" },
        html_url: "https://github.com/guest_dev/microservices-uptime-monitor",
        private: true,
        stargazers_count: 12,
        forks_count: 2,
      }
    ]);
  }

  // Use the session's access token to fetch the repos
  const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: {
      Authorization: `Bearer ${(session as any).accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    }
  });

  const data = await res.json();
  return NextResponse.json(data);
}