// Mint tIDRX (Transfer dari alamat nol) = top-up yang sudah dicetak backend setelah pembayaran (simulasi IDRX).
import { indexer } from "envio";

const ALAMAT_NOL = "0x0000000000000000000000000000000000000000";

indexer.onEvent({ contract: "TestIDRX", event: "Transfer" }, async ({ event, context }) => {
  const { from, to, value } = event.params;
  if (from.toLowerCase() !== ALAMAT_NOL) return;
  context.TopUp.set({
    id: `${event.block.number}-${event.logIndex}`, ke: to, jumlah: value,
    waktu: BigInt(event.block.timestamp), tx: event.transaction.hash,
  });
  const pl = await context.Pelanggan.getOrCreate({ id: to, jumlahOrder: 0, totalBayar: 0n, totalRefund: 0n, nft: 0, totalTopUp: 0n });
  context.Pelanggan.set({ ...pl, totalTopUp: pl.totalTopUp + value });
  const st = await context.Statistik.getOrCreate({
    id: "global", sesiAktif: 0, feeRelay: 0n, order: 0, selesai: 0, expired: 0, sengketa: 0, relayed: 0,
    volume: 0n, payout: 0n, refund: 0n, topUp: 0n,
  });
  context.Statistik.set({ ...st, topUp: st.topUp + value });
});
