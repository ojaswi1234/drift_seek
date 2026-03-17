import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json(
      { message: 'Please provide a URL to check.' }, 
      { status: 400 }
    );
  }

  try {
    // 1. Ensure the URL has a protocol
    let urlToFetch = targetUrl;
    if (!urlToFetch.startsWith('http://') && !urlToFetch.startsWith('https://')) {
      urlToFetch = 'https://' + urlToFetch;
    }

    // 2. Make the network request
    const response = await fetch(urlToFetch);

    // 3. Return the exact structure your frontend is expecting
    return NextResponse.json({ 
      statusCode: response.status, 
      message: response.statusText, 
    });

  } catch (error: any) {
    // Handle cases where the domain doesn't exist or the fetch fails entirely
    return NextResponse.json(
      { message: 'Failed to check status', details: error.message }, 
      { status: 500 }
    );
  }
}