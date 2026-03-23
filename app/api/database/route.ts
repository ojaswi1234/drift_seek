import dbConnect from "@/lib/db_connect";
import WebServer from "@/lib/models/WebServer";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  await dbConnect();
  const servers = await WebServer.find({});
  // Add static status/reason/latency for now (removed from MongoDB schema)
  const serversWithStaticData = servers.map((server: any) => ({
    ...server.toObject(),
    status: 'up',
    reason: 'No Data (Redis Pending)', 
    latency: 0
  }));
  return Response.json(serversWithStaticData);
}

interface WebServerBody {
  [key: string]: unknown;
}

interface WebServerDocument extends WebServerBody {
  _id: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    await dbConnect();
    const body: WebServerBody = await req.json();
    const webserver: WebServerDocument = await WebServer.create(body);

    // Trigger an initial ping without awaiting so it doesn't block the response
    fetch(new URL('/api/monitor/ping', req.url).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: webserver._id }),
    }).catch(console.error);

    return NextResponse.json({
        ...webserver.toObject(),
        status: 'up',
        reason: 'Redis Pending',
        latency: 0
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return NextResponse.json(
        { message: "A web server with this URL already exists." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.name === "ValidationError") {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }
    console.error("Database error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  try {
    await dbConnect();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    
    if (!id) {
      return NextResponse.json(
        { message: "ID is required" },
        { status: 400 }
      );
    }

    await WebServer.findByIdAndDelete(id);
    return NextResponse.json({ message: "Deleted successfully" });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}


