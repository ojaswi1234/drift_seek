import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import dbConnect from "@/lib/db_connect";
import TeamUser from "@/lib/models/TeamUsers";
import { NextResponse } from "next/server";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    // 1. Authenticate the GET request
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    // 2. Fetch ONLY the servers owned by the logged-in user
    const users = await TeamUser.find();
    return NextResponse.json(
      {
        id: users.map((user) => user.userId),
      },
      { status: 201 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
    //console.log("Database is having some problems......");
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  try {

     const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.email) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    await dbConnect();
    const { userId, user_role } = await req.json();

    const newUser = new TeamUser({
      userId,
      user_role,
    });
    await newUser.save();
    return NextResponse.json(
      { message: "User saved successfully" },
      { status: 201 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
    //console.log("Failed to save....");
  }
}
