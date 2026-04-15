import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { name } = await req.json();

  if (!name || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Ensure user owns the voice
  const voice = await prisma.clonedVoice.findUnique({
    where: { id },
  });

  if (!voice || voice.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updatedVoice = await prisma.clonedVoice.update({
    where: { id },
    data: { name: name.trim() },
  });

  return NextResponse.json({ voice: updatedVoice });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Ensure user owns the voice
  const voice = await prisma.clonedVoice.findUnique({
    where: { id },
  });

  if (!voice || voice.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1. Delete from Supabase Storage
  // We extract the path from the sampleUrl
  // URL looks like: https://[project-id].supabase.co/storage/v1/object/public/voices/[userId]/[fileName]
  // The relative path in the bucket is: `voices/[userId]/[fileName]`
  const urlParts = voice.sampleUrl.split("public/");
  const relativePath = urlParts.length > 1 ? urlParts[1] : null;

  if (relativePath) {
    const { error: storageError } = await supabaseAdmin.storage
      .from("voices")
      .remove([relativePath.replace("voices/", "")]); // supabase client .from('voices') expects path WITHOUT the bucket name
    
    if (storageError) {
      console.warn("Could not delete from Supabase storage (might already be gone):", storageError);
    }
  }

  // 2. Delete from Database
  await prisma.clonedVoice.delete({
    where: { id },
  });

  return NextResponse.json({ success: true });
}
