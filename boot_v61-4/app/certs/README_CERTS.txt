Place your mkcert-generated LAN certificate files here to enable HTTPS automatically.

Recommended filenames (auto-detected):
  vetbara-lan.pem
  vetbara-lan-key.pem

Also auto-detected:
  vetbara.test.pem + vetbara.test-key.pem
  server.pem + server-key.pem
  cert.pem + key.pem

Example mkcert command on the VetBara host computer:

  mkdir -p app/certs
  mkcert \
    -cert-file app/certs/vetbara-lan.pem \
    -key-file app/certs/vetbara-lan-key.pem \
    192.168.0.186 \
    localhost \
    127.0.0.1

Replace 192.168.0.186 with the current LAN IP of the VetBara host.
Install and trust the mkcert root CA on tablets, otherwise HTTPS/GPS will still be blocked.

When these files exist, Start VetBara Admin/Centre will run HTTPS automatically.
