import { NextResponse } from "next/server";
import { getProviderConnections, reorderProviderConnectionsByIds } from "@/models";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
    const orderedIds = Array.isArray(body?.orderedIds) ? body.orderedIds.filter((id) => typeof id === "string" && id.trim()) : [];
    if (!provider || orderedIds.length === 0) {
      return NextResponse.json({ error: "provider and orderedIds are required" }, { status: 400 });
    }

    const existing = await getProviderConnections({ provider });
    if (existing.length === 0) return NextResponse.json({ error: "Provider has no connections" }, { status: 404 });

    const connections = await reorderProviderConnectionsByIds(provider, orderedIds);
    return NextResponse.json({ connections });
  } catch (error) {
    console.log("Error reordering providers:", error);
    return NextResponse.json({ error: "Failed to reorder connections" }, { status: 500 });
  }
}
