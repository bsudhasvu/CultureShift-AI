const { runCultureShift } = require("./cultureshift");
const { SCOPE } = require("./agent");

const candidates = [
  {
    id: "E7EBD7F6-5B44-4AEB-BEA0-92317FD35BC3",
    name: "Ravi Shankar",
    scope: SCOPE.ACCOMPANIMENT_CONTEXT
  },
  {
    id: "B44BC27C-9617-41F8-9143-C9C7B499543A",
    name: "Anoushka Shankar",
    scope: SCOPE.ACCOMPANIMENT_CONTEXT
  },
  {
    id: "9986F595-C20E-4EBB-828F-55E7DEEBE448",
    name: "A.R. Rahman",
    scope: SCOPE.ACCOMPANIMENT_CONTEXT
  }
];

const input = {
  candidates,
  optionType: "artist",

  // Previously validated Qloo entity: BTS
  audienceSignals: [
    "F347D506-CB6F-46FA-9A8B-AFBC31C71A1A"
  ],

  // Hard cultural preservation constraint
  preserveTags: [
    "urn:tag:genre:music:indian_classical"
  ]
};

runCultureShift(input)
  .then(result => {
    console.log(
      JSON.stringify(result, null, 2)
    );
  })
  .catch(error => {
    console.error("CultureShift test failed:");
    console.error(error.message);
    process.exitCode = 1;
  });