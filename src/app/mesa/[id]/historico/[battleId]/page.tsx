import BattleHistoryView from "@/components/mesa/BattleHistoryView";

export default async function BattleHistoryPage({ params }: { params: Promise<{ id: string; battleId: string }> }) {
  const { id, battleId } = await params;
  return <BattleHistoryView sessionId={id} battleId={battleId} />;
}
