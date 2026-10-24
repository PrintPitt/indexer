# PrintPitt · indexer (Envio, BLZ-20)

Envio HyperIndex 3.14 untuk `FotokopiKilat` + `TestIDRX`. Keputusan: repo `PrintPitt/vault`, Decision Log D-16.
Event live untuk game tetap lewat WebSocket langsung ke RPC. Indexer ini untuk snapshot saat FE dibuka,
riwayat order, leaderboard omzet per sesi, profil pelanggan (NFT, refund), dan top-up tIDRX.

## Isi

- `config.yaml`: Monad testnet 10143 lewat HyperSync, anvil 31337 lewat RPC.
- `schema.graphql`: Order, Toko, Sesi, OmzetSesi, Pelanggan, TopUp, Katalog, Statistik.
- `src/handlers/`: satu file per contract.
- `abis/`: ditulis oleh `script/export.mjs` di repo `PrintPitt/contracts` (clone di sebelah repo ini). Jangan diedit manual.

## Perintah

```bash
npm install
npm run codegen     # wajib setelah clone (tipe .envio/types.d.ts tidak di-commit)     # setelah config.yaml / schema.graphql berubah
npm run typecheck
npm test            # event simulasi, tanpa Docker dan tanpa jaringan
npm run dev         # indexer lokal + GraphQL di http://localhost:8080, BUTUH Docker (OrbStack)
```

`npm run dev` mengindeks kedua chain. Untuk testnet isi `.env` dari `.env.example`
(`ENVIO_API_TOKEN`, `ENVIO_FK_ADDRESS`, `ENVIO_TIDRX_ADDRESS`, `ENVIO_START_BLOCK`) setelah deploy BLZ-07.

## Contoh query FE

```graphql
query Papan($sesi: String!) {
  OmzetSesi(where: { sesi_id: { _eq: $sesi } }, order_by: { omzet: desc }) { toko { nama } omzet selesai }
  Order(where: { status: { _in: ["Open", "Claimed"] } }, order_by: { dibuatPada: asc }) { id label teks harga status toko_id dibuatPada }
}
```
