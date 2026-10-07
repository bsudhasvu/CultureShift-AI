const { rankBridges } = require("./qloo-http");

async function main() {
  const result = await rankBridges({
    options: [
      "9986F595-C20E-4EBB-828F-55E7DEEBE448",
      "B44BC27C-9617-41F8-9143-C9C7B499543A",
      "E7EBD7F6-5B44-4AEB-BEA0-92317FD35BC3"
    ],
    optionType: "artist",
    signals: [
      "F347D506-CB6F-46FA-9A8B-AFBC31C71A1A"
    ]
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});