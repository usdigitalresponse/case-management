static void Check(bool condition, string message)
{
  if (!condition) throw new Exception(message);
}

var existingForm = "<form><events><event name='onload' /></events><tabs><tab name='maker' id='preserved'><labels><label description='Maker layout' /></labels><columns><column><sections><section><rows><row><cell><control id='old' datafieldname='cm_old' /></cell></row></rows></section></sections></column></columns></tab></tabs></form>";
var generatedForm = "<form><tabs><tab name='generated'><labels><label description='Generated' /></labels><columns><column><sections><section><rows><row><cell><control id='old' datafieldname='cm_old' /></cell></row><row><cell><control id='new' datafieldname='cm_new' disabled='true' /></cell></row></rows></section></sections></column></columns></tab></tabs></form>";
var mergedForm = FormMaintenance.AddMissingFields(existingForm, generatedForm);
var mergedXml = System.Xml.Linq.XDocument.Parse(mergedForm);
Check(mergedXml.Descendants("event").Single().Attribute("name")!.Value == "onload", "Maker event lost.");
Check(mergedXml.Descendants("tab").First().Attribute("id")!.Value == "preserved", "Maker tab replaced.");
Check(mergedXml.Descendants("control").Count() == 2, "Missing or duplicate fields after merge.");
Check(mergedXml.Descendants("control").Last().Attribute("disabled")!.Value == "true", "Review field unlocked.");
Check(FormMaintenance.AddMissingFields(mergedForm, generatedForm) == mergedForm, "Form merge is not idempotent.");
Check(FormMaintenance.AddMissingFields(existingForm, existingForm) == existingForm, "Unchanged form rewritten.");
Console.WriteLine("PASS: form additions preserve maker layout/events, remain locked, and do not duplicate on rerun.");

foreach (var (input, expected) in new[] {
  (" https://sample.crm.dynamics.com/ ", "https://sample.crm.dynamics.com"),
  ("https://sample.api.crm4.dynamics.com/api/data/v9.2/", "https://sample.crm4.dynamics.com"),
  ("https://SAMPLE.CRM.DYNAMICS.COM/api/data/v9.1", "https://sample.crm.dynamics.com")
}) Check(Setup.NormalizeUrl(input) == expected, "URL normalization failed.");

foreach (var input in new[] {
  "http://sample.crm.dynamics.com", "https://make.powerapps.com/",
  "https://sample.crm.dynamics.com.evil.example/", "https://user:password@sample.crm.dynamics.com/",
  "https://sample.crm.dynamics.com/?token=secret", "https://sample.crm.dynamics.com/#fragment",
  "https://sample.crm.dynamics.com:8443/", "https://sample.crm.dynamics.com/main.aspx",
  "https://sample.crm.dynamics.com/api/data/v9.2/WhoAmI", "not-a-url",
  "https://sample.crm.microsoftdynamics.us/"
}) {
  try { Setup.NormalizeUrl(input); throw new Exception("Accepted invalid URL: " + input); }
  catch (ArgumentException) { }
}

async Task<List<string>> Flow(string answers, bool exists, int inspectExit = 0, int operationExit = 0, int expectedExit = 0)
{
  var calls = new List<string>();
  var output = new StringWriter();
  var exit = await Setup.Run(new StringReader(answers), output, (mode, url, id) => {
    Check(url == "https://sample.crm.dynamics.com", "Unexpected target.");
    calls.Add(mode);
    return Task.FromResult(mode == "setup-inspect"
      ? new Setup.Result(inspectExit, "Synthetic development environment", exists)
      : new Setup.Result(operationExit));
  });
  Check(exit == expectedExit, "Unexpected exit status.");
  return calls;
}

Check((await Flow("\n", false)).Count == 0, "Cancel contacted the environment.");
Check((await Flow("https://sample.crm.dynamics.com\n\n\n", false)).SequenceEqual(new[] { "setup-inspect" }), "Blank confirmation deployed.");
Check((await Flow("https://sample.crm.dynamics.com\n\nSET UP\n", false)).SequenceEqual(new[] { "setup-inspect", "deploy" }), "New installation sequence failed.");
Check((await Flow("https://sample.crm.dynamics.com\n\n\n", true)).SequenceEqual(new[] { "setup-inspect", "verify" }), "Existing installation should default to read-only verification.");
Check((await Flow("https://sample.crm.dynamics.com\n\nREBUILD\n", true)).SequenceEqual(new[] { "setup-inspect", "deploy" }), "Explicit rebuild failed.");
Check((await Flow("https://sample.crm.dynamics.com\n\nSET UP\n", true)).SequenceEqual(new[] { "setup-inspect" }), "Wrong confirmation rebuilt an existing installation.");
Check((await Flow("https://sample.crm.dynamics.com\n\nSET UP\n", false, inspectExit: 1, expectedExit: 1)).SequenceEqual(new[] { "setup-inspect" }), "Failed inspection proceeded to deployment.");
await Flow("https://sample.crm.dynamics.com\n\nSET UP\n", false, operationExit: 1, expectedExit: 1);
await Flow("https://make.powerapps.com/\nhttps://sample.crm.dynamics.com\n\nSET UP\n", false);

string? capturedId = null;
await Setup.Run(new StringReader("https://sample.crm.dynamics.com\ninvalid\n00000000-0000-4000-8000-000000000001\n\n"), new StringWriter(), (mode, url, id) => {
  capturedId = id;
  return Task.FromResult(new Setup.Result(0, "Synthetic environment"));
});
Check(capturedId == "00000000-0000-4000-8000-000000000001", "Application ID validation failed.");
Console.WriteLine("PASS: URL validation, normalization, cancellation, confirmation, existing-installation defaults, failure handling, and application ID prompts. No network calls made.");
