import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ tool: string }> }
) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { tool } = await params;

  const entries = await prisma.generationHistory.findMany({
    where: { userId: user.id, tool },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ entries });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ tool: string }> }
) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { tool } = await params;
  const body = await req.json();

  const entry = await prisma.generationHistory.create({
    data: {
      userId: user.id,
      tool,
      voiceUsed: body.voiceUsed || null,
      inputText: body.inputText || "",
      audioUrl: body.audioUrl || null,
      metadata: body.metadata || null,
    },
  });

  return NextResponse.json({ entry }, { status: 201 });
}
