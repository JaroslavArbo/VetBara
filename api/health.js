export default function handler(request, response) {
  response.status(200).json({ ok: true, service: "vetbara", time: new Date().toISOString() });
}
