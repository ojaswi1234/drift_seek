import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import dbConnect from "@/lib/db_connect";
import TeamUser from "@/lib/models/TeamUsers";
import { NextResponse } from "next/server";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const teamId = searchParams.get("teamId");
    if (!teamId) {
      return NextResponse.json({ message: "teamId is required" }, { status: 400 });
    }

    await dbConnect();
    const users = await TeamUser.find({ teamId });
    return NextResponse.json(
      { members: users.map((user) => ({ userId: user.userId, role: user.role })) },
      { status: 200 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const { teamId, userId, role } = await req.json();

    if (!teamId || !userId || !role) {
      return NextResponse.json(
        { message: "teamId, userId, and role are all required" },
        { status: 400 },
      );
    }

    const newUser = new TeamUser({ teamId, userId, role });
    await newUser.save();
    return NextResponse.json({ message: "User saved successfully" }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}