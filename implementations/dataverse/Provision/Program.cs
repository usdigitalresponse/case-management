using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Extensions.Msal;

if (args.Length == 0 || (args.Length == 1 && args[0] == "setup")) {
  Environment.ExitCode = await Setup.Run(Console.In, Console.Out);
  return;
}

const string solution = "CaseIntakePrototype";
const string publisher = "caseprototype";
const string appName = "cm_caseintake";
var tables = new Table[] {
  new("client", "Client", "Clients", true, [
    new("given_name", "Given name", "text", true),
    new("middle_name", "Middle name", "text"),
    new("family_name", "Family name", "text", true),
    new("date_of_birth", "Date of birth", "date")]),
  new("county", "County", "Counties", false, [new("active", "Active", "bool", true)]),
  new("case_category", "Case Category", "Case Categories", false, [new("active", "Active", "bool", true)]),
  new("case_status", "Case Status", "Case Statuses", false, [new("active", "Active", "bool", true)]),
  new("case", "Case", "Cases", true, [
    new("client_id", "Client", "lookup", true, "client"),
    new("status_id", "Case status", "lookup", true, "case_status"),
    new("external_reference", "External reference", "text"),
    new("county_id", "County", "lookup", false, "county"),
    new("case_category_id", "Case category", "lookup", false, "case_category"),
    new("opened_on", "Opened on", "date"),
    new("closed_on", "Closed on", "date")])
};

var reviewMode = args[0].EndsWith("-review");
ReviewPackage? review = null;
if (reviewMode) {
  var file = args[0] == "--check-review" && args.Length == 2 ? args[1] : args.Length == 3 ? args[2] : null;
  if (file == null) throw new ArgumentException("Review commands require a prepared package path.");
  review = JsonSerializer.Deserialize<ReviewPackage>(File.ReadAllText(file))!;
  tables = review.Tables;
  ReviewChecks.Validate(review);
  if (args[0] == "--check-review") {
    foreach (var table in tables) {
      _ = XDocument.Parse(Form(table, true));
      foreach (var field in table.Fields) _ = Attribute(field);
    }
    Console.WriteLine($"PASS: {tables.Length} review tables, form XML, and {review.Rows.Length} synthetic rows.");
    return;
  }
}

if (args.Length == 1 && args[0] == "--check") {
  foreach (var table in tables) {
    _ = XDocument.Parse(Form(table));
    foreach (var field in table.Fields.Where(f => f.Type != "lookup")) _ = Attribute(field);
  }
  var form = XDocument.Parse(Form(tables.Single(t => t.Key == "case")));
  var controls = form.Descendants("control").Select(x => (string?)x.Attribute("datafieldname")).ToArray();
  var expected = new[] { "cm_name", "cm_client_id", "cm_status_id", "cm_external_reference", "cm_county_id", "cm_case_category_id", "cm_opened_on" };
  if (!controls.SequenceEqual(expected)) throw new Exception("Case form differs from intake mapping.");
  Console.WriteLine("PASS: five table definitions and form XML; intake fields match the mapping.");
  return;
}
if ((!reviewMode && args.Length != 2) || !new[] { "inspect", "setup-inspect", "deploy", "verify", "smoke", "upgrade-client", "deploy-review", "seed-review", "verify-review", "reset-review" }.Contains(args[0]))
  throw new ArgumentException("Usage: Provision --check | Provision inspect|deploy|verify|smoke|upgrade-client https://ENVIRONMENT.crm.dynamics.com");
var environment = new Uri(args[1]);
if (environment.Scheme != "https" || environment.AbsolutePath != "/" || !string.IsNullOrEmpty(environment.Query))
  throw new ArgumentException("Provide the HTTPS environment origin, without an API path or query.");

// Microsoft's example client is for development only. Override for a tenant-owned app.
var clientId = Environment.GetEnvironmentVariable("DATAVERSE_CLIENT_ID") ?? "51f81489-12ee-4a9e-aaae-a2591f45987d";
var identity = PublicClientApplicationBuilder.Create(clientId)
  .WithAuthority("https://login.microsoftonline.com/organizations").Build();
if (OperatingSystem.IsMacOS() || OperatingSystem.IsWindows()) {
  var cacheDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CaseIntakePrototype");
  var storage = new StorageCreationPropertiesBuilder("msal.cache", cacheDir)
    .WithMacKeyChain("CaseIntakePrototype", clientId).Build();
  var cache = await MsalCacheHelper.CreateAsync(storage);
  cache.VerifyPersistence();
  cache.RegisterCache(identity.UserTokenCache);
}
var scopes = new[] { environment.GetLeftPart(UriPartial.Authority) + "/user_impersonation" };
var accounts = (await identity.GetAccountsAsync()).ToArray();
AuthenticationResult auth;
try {
  auth = await identity.AcquireTokenSilent(scopes, accounts.Length == 1 ? accounts[0] : null).ExecuteAsync();
} catch (MsalUiRequiredException) {
  auth = await identity.AcquireTokenWithDeviceCode(scopes, code => {
    Console.WriteLine(code.Message);
    return Task.CompletedTask;
  }).ExecuteAsync();
}
using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) {
  BaseAddress = new Uri(environment, "api/data/v9.2/"), Timeout = TimeSpan.FromMinutes(5)
};
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
http.DefaultRequestHeaders.Add("OData-Version", "4.0");
http.DefaultRequestHeaders.Add("OData-MaxVersion", "4.0");
var who = await Api("GET", "WhoAmI");
Console.WriteLine("Connected to requested environment; identity verified.");
var orgId = who!["OrganizationId"]!.GetValue<string>();
var org = await Api("GET", $"organizations({orgId})?$select=name,isauditenabled,languagecode");
if (org!["languagecode"]!.GetValue<int>() != 1033)
  throw new Exception("This initial package requires an English base language (1033).");

if (args[0] == "setup-inspect") {
  var existing = await Api("GET", "solutions?$select=uniquename&$filter=uniquename eq 'CaseIntakePrototype'");
  Console.WriteLine("SETUP_RESULT:" + JsonSerializer.Serialize(new Setup.Result(0, org["name"]!.GetValue<string>(), existing!["value"]!.AsArray().Count > 0)));
  return;
}
if (args[0] == "inspect") {
  var customTables = await Api("GET", "EntityDefinitions?$select=LogicalName&$filter=IsCustomEntity eq true");
  var customRelationships = await Api("GET", "RelationshipDefinitions?$select=SchemaName&$filter=IsCustomRelationship eq true");
  Console.WriteLine($"Prototype metadata: {customTables!["value"]!.AsArray().Count(x => x!["LogicalName"]!.GetValue<string>().StartsWith("cm_"))} tables; {customRelationships!["value"]!.AsArray().Count(x => x!["SchemaName"]!.GetValue<string>().StartsWith("cm_"))} relationships.");
  var existing = await Api("GET", "solutions?$select=uniquename&$filter=uniquename eq 'CaseIntakePrototype'");
  Console.WriteLine($"Prototype solutions: {existing!["value"]!.AsArray().Count}; environment audit enabled: {org["isauditenabled"]}");
  var apps = await Api("GET", $"appmodules/Microsoft.Dynamics.CRM.RetrieveUnpublishedMultiple()?$select=appmoduleid,clienttype,formfactor&$filter=uniquename eq '{appName}'");
  if (apps!["value"]!.AsArray().Count == 1) {
    Console.WriteLine("Unpublished app settings: " + apps["value"]![0]!.ToJsonString());
    var id = apps["value"]![0]!["appmoduleid"]!.GetValue<string>();
    Console.WriteLine((await Api("GET", $"RetrieveAppComponents(AppModuleId={id})"))?.ToJsonString());
  }
  return;
}
if (!reviewMode && args[0] is "deploy" or "verify" or "smoke") {
  var expanded = await Api("GET", "EntityDefinitions(LogicalName='cm_person')?$select=MetadataId", missing: true);
  if (expanded != null) throw new Exception("The 0.2 model-review schema is present. Use deploy-review, seed-review or verify-review with the prepared package; the 0.1 guided baseline cannot change or verify this slice.");
}
if (args[0] == "upgrade-client") {
  var apps = await Api("GET", $"appmodules?$select=appmoduleid&$filter=uniquename eq '{appName}'");
  var app = apps!["value"]!.AsArray().Single()!;
  var id = app["appmoduleid"]!.GetValue<string>();
  await Api("PATCH", $"appmodules({id})", new { clienttype = 4 });
  await Api("POST", "PublishXml", new { ParameterXml = $"<importexportxml><appmodules><appmodule>{id}</appmodule></appmodules></importexportxml>" });
  await Api("POST", "PublishAllXml", new { });
  Console.WriteLine("Published Unified Interface client setting and republished all customizations.");
}
if (args[0] == "reset-review") await ResetReviewData();
if (args[0] is "deploy" or "deploy-review" or "reset-review") {
  Console.WriteLine("Creating the prototype solution and table definitions...");
  var pubId = await EnsureRecord("publishers", "publisherid", "uniquename", publisher,
    new { uniquename = publisher, friendlyname = "Case Prototype", customizationprefix = "cm", customizationoptionvalueprefix = 74000 });
  var solutionId = await EnsureRecord("solutions", "solutionid", "uniquename", solution,
    new Dictionary<string, object> {
      ["uniquename"] = solution, ["friendlyname"] = "Case Intake Prototype", ["version"] = "0.1.0.0",
      ["description"] = "Synthetic case intake prototype; platform-neutral model remains authoritative.",
      ["publisherid@odata.bind"] = $"/publishers({pubId})"
    });
  if (reviewMode) await Api("PATCH", $"solutions({solutionId})", new { version = "0.2.0.0", description = "Synthetic domain model review; runtime workflow enforcement remains separate." });
  http.DefaultRequestHeaders.Add("MSCRM.SolutionUniqueName", solution);
  await DeployTablesAndRelationships(reviewMode);
  var (formIds, viewIds) = await DeployFormsAndViews(reviewMode);
  if (!org["isauditenabled"]!.GetValue<bool>())
    await Api("PATCH", $"organizations({orgId})", new { isauditenabled = true });
  await PublishTables();
  if (!reviewMode) await Seed();
  var appId = await DeployAppAndSiteMap(reviewMode, formIds, viewIds);
  Console.WriteLine($"App: {environment}main.aspx?appid={appId}");
}
if (reviewMode && args[0] is "deploy-review" or "seed-review" or "reset-review") await SeedReview();
await Verify();
if (reviewMode) await VerifyReview();
if (args[0] == "smoke") await Smoke();

async Task<JsonNode?> Api(string method, string path, object? body = null, bool missing = false) {
  if (Uri.TryCreate(path, UriKind.Absolute, out _)) throw new ArgumentException("API paths must be relative.");
  using var request = new HttpRequestMessage(new HttpMethod(method), path);
  if (body != null) request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
  using var response = await http.SendAsync(request);
  if (missing && response.StatusCode == HttpStatusCode.NotFound) return null;
  var text = await response.Content.ReadAsStringAsync();
  if (!response.IsSuccessStatusCode) throw new Exception($"{method} {path}: {(int)response.StatusCode}: {text}");
  if (!string.IsNullOrWhiteSpace(text)) return JsonNode.Parse(text);
  if (response.Headers.TryGetValues("OData-EntityId", out var entityHeaders)) {
    var entityUri = entityHeaders.Single();
    return new JsonObject { ["createdId"] = entityUri[(entityUri.LastIndexOf('(') + 1)..].TrimEnd(')') };
  }
  return null;
}
async Task<string> EnsureRecord(string set, string idField, string key, string value, object body) {
  var readSet = set == "appmodules" ? "appmodules/Microsoft.Dynamics.CRM.RetrieveUnpublishedMultiple()" : set;
  var found = await Api("GET", $"{readSet}?$select={idField}&$filter={key} eq '{value}'");
  if (found!["value"]!.AsArray().Count > 1) throw new Exception($"Ambiguous existing {set}: {value}");
  if (found["value"]!.AsArray().Count == 0) {
    var created = await Api("POST", set, body);
    if (created?["createdId"] != null) return created["createdId"]!.GetValue<string>();
    found = await Api("GET", $"{readSet}?$select={idField}&$filter={key} eq '{value}'");
  }
  return found!["value"]![0]![idField]!.GetValue<string>();
}
async Task AddComponent(string id, int type) => await Api("POST", "AddSolutionComponent", new {
  ComponentId = id, ComponentType = type, SolutionUniqueName = solution, AddRequiredComponents = false, DoNotIncludeSubcomponents = false
});
async Task ResetReviewData() {
  // Deletes every cm_-prefixed custom table (and therefore all its records, forms,
  // views and relationships) in this environment, so deploy-review can rebuild and
  // reseed from a clean slate. This is irreversible and is not scoped to only the
  // entities in the current review package: it also removes tables from earlier
  // schema revisions (e.g. a since-removed entity) that would otherwise collide with
  // the rebuild, and any other cm_-prefixed customization sharing this prefix.
  //
  // Deleting a whole table removes its own forms, views and relationships together;
  // deleting any of those individually ahead of time runs into Dataverse invariants
  // that don't apply to whole-table deletion (a relationship "referenced by" other
  // components, an entity needing at least one active Main/Card form). The only
  // ordering constraint that remains is relationship-driven: an entity cannot be
  // deleted while another entity still has a relationship pointing at it, so tables
  // are deleted in retry passes until every one succeeds.
  var relationshipNames = (await Api("GET", "RelationshipDefinitions?$select=SchemaName&$filter=IsCustomRelationship eq true"))!
    ["value"]!.AsArray().Select(x => x!["SchemaName"]!.GetValue<string>()).Where(n => n.StartsWith("cm_")).ToArray();
  var entityNames = (await Api("GET", "EntityDefinitions?$select=LogicalName&$filter=IsCustomEntity eq true"))!
    ["value"]!.AsArray().Select(x => x!["LogicalName"]!.GetValue<string>()).Where(n => n.StartsWith("cm_")).OrderBy(n => n).ToArray();

  Console.WriteLine();
  Console.WriteLine("=================== DESTRUCTIVE RESET ===================");
  Console.WriteLine($"Environment : {environment}");
  Console.WriteLine($"Organization: {org!["name"]}");
  Console.WriteLine($"This will PERMANENTLY DELETE {entityNames.Length} custom table(s) and all their");
  Console.WriteLine($"records, plus {relationshipNames.Length} custom relationship(s):");
  foreach (var name in entityNames) {
    var count = "unknown";
    try {
      var meta = await Api("GET", $"EntityDefinitions(LogicalName='{name}')?$select=EntitySetName");
      var rows = await Api("GET", $"{meta!["EntitySetName"]!.GetValue<string>()}?$select={name}id&$count=true&$top=1");
      count = rows!["@odata.count"]!.GetValue<int>().ToString();
    } catch { /* best-effort; a missing count never blocks the confirmation display */ }
    Console.WriteLine($"  - {name} ({count} record(s))");
  }
  Console.WriteLine("This deletes ANY cm_-prefixed custom table in this environment, not only ones");
  Console.WriteLine("belonging to the CaseIntakePrototype solution. There is no undo.");
  Console.WriteLine("===========================================================");
  Console.WriteLine();

  if (entityNames.Length == 0 && relationshipNames.Length == 0) {
    Console.WriteLine("Nothing to reset; no cm_-prefixed customizations exist yet.");
    return;
  }

  Console.Write($"Type the organization name shown above ({org!["name"]}) to continue: ");
  if (Console.ReadLine() != org!["name"]!.GetValue<string>()) throw new Exception("Reset aborted: organization name did not match.");
  var token = Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
  Console.Write($"Type this confirmation code to permanently delete the data above: {token}\n> ");
  if (Console.ReadLine() != token) throw new Exception("Reset aborted: confirmation code did not match.");

  Console.WriteLine("Confirmed. Removing the app and sitemap first...");
  // Every table, form and view was registered as an explicit app module component
  // when the app was built (AddAppComponents); that registration alone blocks
  // deleting any of them, so it goes before anything else.
  var apps = (await Api("GET", $"appmodules?$select=appmoduleid&$filter=uniquename eq '{appName}'"))!["value"]!.AsArray();
  foreach (var app in apps) await Api("DELETE", $"appmodules({app!["appmoduleid"]!.GetValue<string>()})");
  Console.WriteLine($"  Deleted {apps.Count} app module(s).");
  var maps = (await Api("GET", "sitemaps?$select=sitemapid&$filter=sitemapnameunique eq 'cm_caseintake_sitemap'"))!["value"]!.AsArray();
  foreach (var map in maps) await Api("DELETE", $"sitemaps({map!["sitemapid"]!.GetValue<string>()})");
  Console.WriteLine($"  Deleted {maps.Count} sitemap(s).");

  // Forms and relationships are deliberately not deleted individually here: Dataverse
  // enforces "at least one active Main form" per entity on standalone form deletion,
  // and enforces "referenced by other components" on standalone relationship deletion
  // — neither invariant applies when the whole entity is deleted at once, which takes
  // its own forms, views and relationships with it.
  Console.WriteLine("Deleting tables...");
  var remaining = entityNames.ToList();
  var lastErrors = new Dictionary<string, string>();
  for (var pass = 1; remaining.Count > 0; pass++) {
    if (pass > entityNames.Length + 1)
      throw new Exception("Reset stalled; see per-table errors above.");
    var stillBlocked = new List<string>();
    foreach (var name in remaining) {
      try {
        await Api("DELETE", $"EntityDefinitions(LogicalName='{name}')");
        Console.WriteLine($"  Deleted table: {name}");
      } catch (Exception ex) {
        stillBlocked.Add(name);
        lastErrors[name] = ex.Message;
      }
    }
    if (stillBlocked.Count == remaining.Count) {
      Console.WriteLine($"Pass {pass}: no progress. Errors:");
      foreach (var name in stillBlocked) Console.WriteLine($"  {name}: {lastErrors[name]}");
      throw new Exception($"Reset stalled on pass {pass}; {stillBlocked.Count} table(s) still blocked, see errors above.");
    }
    remaining = stillBlocked;
  }
  Console.WriteLine("Reset complete. Rebuilding from the prepared review package...");
}
async Task DeployTablesAndRelationships(bool reviewMode) {
  foreach (var table in tables) {
    var existing = await Api("GET", $"EntityDefinitions(LogicalName='{table.Name}')?$select=MetadataId,OwnershipType", missing: true);
    if (existing == null) {
      var name = Attribute(new("name", table.Key == "case" ? "Case number" : "Display name", "text", table.Key != "case"));
      name["IsPrimaryName"] = true;
      if (table.Key == "case") name["AutoNumberFormat"] = "CASE-{SEQNUM:6}";
      var attrs = new JsonArray(name);
      foreach (var f in table.Fields.Where(f => f.Type != "lookup")) attrs.Add(Attribute(f));
      await Api("POST", "EntityDefinitions", new JsonObject {
        ["@odata.type"] = "Microsoft.Dynamics.CRM.EntityMetadata", ["SchemaName"] = table.Name,
        ["DisplayName"] = Label(table.Label), ["DisplayCollectionName"] = Label(table.Plural),
        ["Description"] = Label("Synthetic case intake prototype. See the platform-neutral model."),
        ["OwnershipType"] = table.Owned ? "UserOwned" : "OrganizationOwned",
        ["IsActivity"] = false, ["HasActivities"] = false, ["HasNotes"] = false,
        ["IsAuditEnabled"] = new JsonObject { ["Value"] = true }, ["Attributes"] = attrs
      });
    }
    var meta = await Api("GET", $"EntityDefinitions(LogicalName='{table.Name}')?$select=MetadataId,OwnershipType&$expand=Attributes($select=LogicalName)");
    if (meta!["OwnershipType"]!.GetValue<string>() != (table.Owned ? "UserOwned" : "OrganizationOwned"))
      throw new Exception($"Existing {table.Name} has a different ownership model; review before proceeding.");
    var names = meta["Attributes"]!.AsArray().Select(x => x!["LogicalName"]!.GetValue<string>()).ToHashSet();
    foreach (var f in table.Fields.Where(f => f.Type != "lookup" && !names.Contains("cm_" + f.Key)))
      await Api("POST", $"EntityDefinitions(LogicalName='{table.Name}')/Attributes", Attribute(f));
    if (reviewMode) await SyncRequiredLevels(table);
    await AddComponent(meta["MetadataId"]!.GetValue<string>(), 1);
    Console.WriteLine($"Table ready: {table.Name}");
  }
  foreach (var table in tables)
  foreach (var f in table.Fields.Where(f => f.Type == "lookup")) {
    var schema = $"cm_{f.Target}_{table.Key}_{f.Key}";
    var found = await Api("GET", $"RelationshipDefinitions?$select=SchemaName&$filter=SchemaName eq '{schema}'");
    if (found!["value"]!.AsArray().Count > 0) continue;
    await Api("POST", "RelationshipDefinitions", new JsonObject {
      ["@odata.type"] = "Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata", ["SchemaName"] = schema,
      ["ReferencedEntity"] = "cm_" + f.Target, ["ReferencedAttribute"] = "cm_" + f.Target + "id",
      ["ReferencingEntity"] = table.Name, ["ReferencingEntityNavigationPropertyName"] = "cm_" + f.Key,
      ["AssociatedMenuConfiguration"] = new JsonObject { ["Behavior"] = "UseCollectionName", ["Group"] = "Details", ["Order"] = 10000 },
      ["CascadeConfiguration"] = new JsonObject {
        ["Assign"] = "NoCascade", ["Delete"] = "Restrict", ["Merge"] = "NoCascade",
        ["Reparent"] = "NoCascade", ["Share"] = "NoCascade", ["Unshare"] = "NoCascade"
      }, ["Lookup"] = Attribute(f)
    });
  }
}
async Task SyncRequiredLevels(Table table) {
  // Only the 0.2 review path resyncs requiredness on existing attributes; 0.1 baseline
  // fields never change requiredness after creation, so this step would be a no-op there.
  var attributes = await Api("GET", $"EntityDefinitions(LogicalName='{table.Name}')/Attributes?$select=LogicalName,MetadataId,RequiredLevel");
  foreach (var attribute in attributes!["value"]!.AsArray()) {
    var logical = attribute!["LogicalName"]!.GetValue<string>();
    if (!logical.StartsWith("cm_") || logical == "cm_name" || logical == table.Name + "id") continue;
    var desired = table.Fields.FirstOrDefault(f => "cm_" + f.Key == logical);
    var level = desired?.Required == true ? "ApplicationRequired" : "None";
    if (attribute["RequiredLevel"]!["Value"]!.GetValue<string>() == level) continue;
    var full = (await Api("GET", $"EntityDefinitions(LogicalName='{table.Name}')/Attributes({attribute["MetadataId"]})"))!.AsObject();
    full.Remove("@odata.context");
    full["RequiredLevel"] = new JsonObject { ["Value"] = level };
    await Api("PUT", $"EntityDefinitions(LogicalName='{table.Name}')/Attributes({attribute["MetadataId"]})", full);
  }
}
async Task<(List<string> FormIds, List<string> ViewIds)> DeployFormsAndViews(bool reviewMode) {
  var formIds = new List<string>();
  var viewIds = new List<string>();
  foreach (var table in tables) {
    var forms = await Api("GET", $"systemforms?$select=formid,name&$filter=objecttypecode eq '{table.Name}' and type eq 2");
    var candidates = forms!["value"]!.AsArray();
    var targetName = reviewMode ? "Synthetic model review" : table.Key == "case" ? "New case" : "Prototype details";
    var chosen = candidates.FirstOrDefault(x => x!["name"]!.GetValue<string>() == targetName) ?? candidates.FirstOrDefault(x => x!["name"]!.GetValue<string>() == (table.Key == "case" ? "New case" : "Prototype details")) ?? candidates.FirstOrDefault();
    if (chosen == null) throw new Exception($"No generated main form for {table.Name}.");
    var formId = chosen["formid"]!.GetValue<string>();
    // Only adopt Dataverse's freshly generated default form once. After that, a schema
    // change to this table's fields will NOT appear on this form until it is deleted so
    // a fresh one can be generated in its place — this deliberately stops overwriting
    // a form once someone may have hand-customized it.
    if (chosen["name"]!.GetValue<string>() == targetName) {
      Console.WriteLine($"  Form for {table.Name} already managed; leaving it as deployed. Field changes to this table will not appear on it until the form is deleted and regenerated.");
    } else {
      await Api("PATCH", $"systemforms({formId})", new { name = targetName, formxml = Form(table, reviewMode) });
    }
    await AddComponent(formId, 60);
    formIds.Add(formId);
    var meta = await Api("GET", $"EntityDefinitions(LogicalName='{table.Name}')?$select=ObjectTypeCode");
    var viewName = reviewMode ? "Synthetic " + table.Plural : table.Key == "case" ? "Cases" : table.Plural;
    var fieldNames = reviewMode ? new[] { "cm_name" }.Concat(table.Fields.Where(f => f.Type != "memo").Take(5).Select(f => "cm_" + f.Key)).ToArray() : table.Key == "case" ? new[] { "cm_name", "cm_client_id", "cm_status_id", "cm_external_reference", "cm_opened_on" } : new[] { "cm_name" };
    var fetch = new XElement("fetch", new XElement("entity", new XAttribute("name", table.Name),
      new XElement("attribute", new XAttribute("name", table.Name + "id")),
      fieldNames.Select(n => new XElement("attribute", new XAttribute("name", n))),
      new XElement("order", new XAttribute("attribute", "cm_name"), new XAttribute("descending", "false"))));
    var layout = new XElement("grid", new XAttribute("name", "resultset"), new XAttribute("object", meta!["ObjectTypeCode"]!.ToString()), new XAttribute("jump", "cm_name"), new XAttribute("select", "1"), new XAttribute("icon", "1"), new XAttribute("preview", "1"),
      new XElement("row", new XAttribute("name", "result"), new XAttribute("id", table.Name + "id"), fieldNames.Select(n => new XElement("cell", new XAttribute("name", n), new XAttribute("width", "180")))));
    var views = await Api("GET", $"savedqueries?$select=savedqueryid&$filter=returnedtypecode eq '{table.Name}' and name eq '{viewName}' and querytype eq 0");
    string viewId;
    if (views!["value"]!.AsArray().Count == 0) {
      viewId = Guid.NewGuid().ToString();
      await Api("POST", "savedqueries", new { savedqueryid = viewId, name = viewName, returnedtypecode = table.Name, querytype = 0, fetchxml = fetch.ToString(), layoutxml = layout.ToString(), isdefault = true });
    } else viewId = views["value"]![0]!["savedqueryid"]!.GetValue<string>();
    await AddComponent(viewId, 26);
    viewIds.Add(viewId);
    Console.WriteLine($"Form and view ready: {table.Name}");
  }
  return (formIds, viewIds);
}
async Task<string> DeployAppAndSiteMap(bool reviewMode, List<string> formIds, List<string> viewIds) {
  // An app module requires a real web resource as its icon, but that GUID is not
  // stable across environments — a reset reprovisions system web resources with
  // new IDs — so discover a usable image web resource at runtime rather than
  // hardcoding one. Prefer PNG (type 5), fall back to SVG (type 11).
  var icons = (await Api("GET", "webresourceset?$select=webresourceid&$filter=webresourcetype eq 5&$top=1"))!["value"]!.AsArray();
  if (icons.Count == 0) icons = (await Api("GET", "webresourceset?$select=webresourceid&$filter=webresourcetype eq 11&$top=1"))!["value"]!.AsArray();
  if (icons.Count == 0) throw new Exception("No PNG or SVG web resource is available in this environment to use as the app icon.");
  var defaultIconId = icons[0]!["webresourceid"]!.GetValue<string>();
  var appBody = new JsonObject { ["uniquename"] = appName, ["name"] = "Case Intake Prototype", ["description"] = reviewMode ? "Synthetic domain model review; workflow enforcement gaps documented in the repository." : "Synthetic case intake: select an existing client and create a case.", ["webresourceid"] = defaultIconId, ["clienttype"] = 4 };
  var appId = await EnsureRecord("appmodules", "appmoduleid", "uniquename", appName, appBody);
  // A healthy app takes a normal PATCH, keeping its stable id and bookmarked URL.
  // If the PATCH fails, the found record is an unpatchable half-created draft from an
  // earlier partial run (create-validation rejects it for a missing required field);
  // delete it and recreate a complete one from appBody.
  try {
    await Api("PATCH", $"appmodules({appId})", new { name = "Case Intake Prototype", clienttype = 4, webresourceid = defaultIconId });
  } catch (Exception) {
    await Api("DELETE", $"appmodules({appId})");
    Console.WriteLine("Removed an unpatchable app record from an earlier partial run; recreating.");
    appId = await EnsureRecord("appmodules", "appmoduleid", "uniquename", appName, appBody);
  }
  var mapXml = new XElement("SiteMap", new XElement("Area", new XAttribute("Id", "intake"),
    new XElement("Titles", new XElement("Title", new XAttribute("LCID", "1033"), new XAttribute("Title", "Case intake"))),
    new XElement("Group", new XAttribute("Id", "cases"), new XAttribute("IsProfile", "false"),
      new XElement("Titles", new XElement("Title", new XAttribute("LCID", "1033"), new XAttribute("Title", "Work"))),
      (reviewMode ? tables.Where(t => review!.Rows.Any(r => r.Table == t.Key) && !t.Fields.All(f => f.Key == "active")) : tables.Where(t => t.Key == "case")).Select(t => new XElement("SubArea", new XAttribute("Id", t.Key + "_list"), new XAttribute("Entity", t.Name))))));
  var mapId = await EnsureRecord("sitemaps", "sitemapid", "sitemapnameunique", "cm_caseintake_sitemap", new {
    sitemapname = "Case Intake", sitemapnameunique = "cm_caseintake_sitemap", sitemapxml = mapXml.ToString()
  });
  if (reviewMode) await Api("PATCH", $"sitemaps({mapId})", new { sitemapxml = mapXml.ToString() });
  var components = new JsonArray(new JsonObject { ["@odata.type"] = "Microsoft.Dynamics.CRM.sitemap", ["sitemapid"] = mapId });
  // Table components are identified by their logical type, not the metadata table.
  foreach (var t in tables) {
    var metadata = await Api("GET", $"EntityDefinitions(LogicalName='{t.Name}')?$select=MetadataId");
    components.Add(new JsonObject { ["@odata.type"] = $"Microsoft.Dynamics.CRM.{t.Name}", [t.Name + "id"] = metadata!["MetadataId"]!.GetValue<string>() });
  }
  foreach (var id in formIds) components.Add(new JsonObject { ["@odata.type"] = "Microsoft.Dynamics.CRM.systemform", ["formid"] = id });
  foreach (var id in viewIds) components.Add(new JsonObject { ["@odata.type"] = "Microsoft.Dynamics.CRM.savedquery", ["savedqueryid"] = id });
  await Api("POST", "AddAppComponents", new JsonObject { ["AppId"] = appId, ["Components"] = components });
  await AddComponent(mapId, 62);
  await AddComponent(appId, 80);
  await Api("POST", "PublishXml", new { ParameterXml = $"<importexportxml><appmodules><appmodule>{appId}</appmodule></appmodules><sitemaps><sitemap>{mapId}</sitemap></sitemaps></importexportxml>" });
  return appId;
}
async Task PublishTables() => await Api("POST", "PublishXml", new { ParameterXml = "<importexportxml><entities>" + string.Concat(tables.Select(t => $"<entity>{t.Name}</entity>")) + "</entities></importexportxml>" });
async Task<string> EntitySet(string key) {
  var meta = await Api("GET", $"EntityDefinitions(LogicalName='cm_{key}')?$select=EntitySetName");
  return meta!["EntitySetName"]!.GetValue<string>();
}
async Task Seed() {
  foreach (var key in new[] { "county", "case_category", "case_status" }) {
    var set = await EntitySet(key);
    var label = key switch { "county" => "Synthetic County A", "case_category" => "Sample Category A", _ => "Sample Intake" };
    await EnsureRecord(set, $"cm_{key}id", "cm_name", label, new { cm_name = label, cm_active = true });
  }
  var clients = await EntitySet("client");
  foreach (var suffix in new[] { "A", "B" })
    await EnsureRecord(clients, "cm_clientid", "cm_name", "Synthetic Client " + suffix,
      new { cm_name = "Synthetic Client " + suffix, cm_given_name = "Synthetic", cm_family_name = "Client " + suffix });
  Console.WriteLine("Synthetic clients and reference records ready; existing records preserved.");
}
async Task Verify() {
  foreach (var table in tables) {
    var meta = await Api("GET", $"EntityDefinitions(LogicalName='{table.Name}')?$select=IsAuditEnabled&$expand=Attributes($select=LogicalName,RequiredLevel)");
    var attrs = meta!["Attributes"]!.AsArray();
    foreach (var field in table.Fields) {
      var attr = attrs.Single(x => x!["LogicalName"]!.GetValue<string>() == "cm_" + field.Key)!;
      if (field.Required && attr["RequiredLevel"]!["Value"]!.GetValue<string>() != "ApplicationRequired")
        throw new Exception($"Requiredness mismatch: {table.Name}.{field.Key}");
    }
    if (!meta["IsAuditEnabled"]!["Value"]!.GetValue<bool>()) throw new Exception("Table auditing is disabled.");
  }
  var apps = await Api("GET", $"appmodules?$select=appmoduleid,statecode,clienttype&$filter=uniquename eq '{appName}'");
  if (apps!["value"]!.AsArray().Single()!["clienttype"]?.GetValue<int>() != 4)
    throw new Exception("App must use Unified Interface. Run upgrade-client to repair the client setting.");
  var appId = apps!["value"]![0]!["appmoduleid"]!.GetValue<string>();
  var validation = await Api("GET", $"ValidateApp(AppModuleId={appId})");
  Console.WriteLine("App validation: " + validation?.ToJsonString());
  if (validation?["AppValidationResponse"]?["ValidationSuccess"]?.GetValue<bool>() != true)
    throw new Exception("App dependency validation failed.");
  var audit = await Api("GET", $"organizations({orgId})?$select=isauditenabled");
  if (audit?["isauditenabled"]?.GetValue<bool>() != true) throw new Exception("Environment auditing is disabled.");
  Console.WriteLine("PASS: table fields, form-required metadata, table auditing, and Unified Interface client verified.");
  Console.WriteLine($"App: {environment}main.aspx?appid={appId}");
}
async Task Smoke() {
  var sets = new Dictionary<string, string>();
  var ids = new Dictionary<string, string>();
  foreach (var key in new[] { "client", "county", "case_category", "case_status", "case" }) {
    sets[key] = await EntitySet(key);
    if (key == "case") continue;
    var label = key switch { "client" => "Synthetic Client A", "county" => "Synthetic County A", "case_category" => "Sample Category A", _ => "Sample Intake" };
    var found = await Api("GET", $"{sets[key]}?$select=cm_{key}id&$filter=cm_name eq '{label}'");
    if (found!["value"]!.AsArray().Count != 1) throw new Exception("Smoke fixture is missing or ambiguous.");
    ids[key] = found["value"]![0]![$"cm_{key}id"]!.GetValue<string>();
  }
  var clientCountBefore = (await Api("GET", $"{sets["client"]}?$select=cm_clientid&$count=true"))!["@odata.count"]!.GetValue<int>();
  var minId = "a3a89191-05f6-4706-9c87-4c5ad64df301";
  var fullId = "a3a89191-05f6-4706-9c87-4c5ad64df302";
  foreach (var id in new[] { minId, fullId }) {
    var existing = await Api("GET", $"{sets["case"]}({id})?$select=cm_caseid", missing: true);
    if (existing != null) continue;
    var body = new JsonObject {
      ["cm_caseid"] = id,
      ["cm_client_id@odata.bind"] = $"/{sets["client"]}({ids["client"]})",
      ["cm_status_id@odata.bind"] = $"/{sets["case_status"]}({ids["case_status"]})"
    };
    if (id == fullId) {
      body["cm_county_id@odata.bind"] = $"/{sets["county"]}({ids["county"]})";
      body["cm_case_category_id@odata.bind"] = $"/{sets["case_category"]}({ids["case_category"]})";
      body["cm_external_reference"] = "SYNTHETIC-SMOKE-CHECK";
      body["cm_opened_on"] = "2030-01-15";
    }
    await Api("POST", sets["case"], body);
    if (id == fullId) await Api("PATCH", $"{sets["case"]}({id})", new { cm_external_reference = "SYNTHETIC-SMOKE-UPDATED" });
  }
  foreach (var id in new[] { minId, fullId }) {
    var saved = await Api("GET", $"{sets["case"]}({id})?$select=cm_name,_cm_client_id_value,_cm_status_id_value,_cm_county_id_value,_cm_case_category_id_value,cm_external_reference,cm_opened_on,cm_closed_on");
    if (string.IsNullOrWhiteSpace(saved!["cm_name"]?.GetValue<string>()) || saved["_cm_client_id_value"]!.GetValue<string>() != ids["client"] || saved["_cm_status_id_value"]!.GetValue<string>() != ids["case_status"])
      throw new Exception("Smoke case identity or references do not match.");
    if (saved["cm_closed_on"] != null) throw new Exception("Closed date should be empty.");
    if (id == minId) {
      foreach (var field in new[] { "_cm_county_id_value", "_cm_case_category_id_value", "cm_external_reference", "cm_opened_on" })
        if (saved[field] != null) throw new Exception("Minimum case unexpectedly has optional values.");
    } else if (saved["_cm_county_id_value"]!.GetValue<string>() != ids["county"] || saved["_cm_case_category_id_value"]!.GetValue<string>() != ids["case_category"] || saved["cm_external_reference"]!.GetValue<string>() != "SYNTHETIC-SMOKE-UPDATED" || !saved["cm_opened_on"]!.GetValue<string>().StartsWith("2030-01-15"))
      throw new Exception("Complete case values were not preserved.");
    Console.WriteLine("PASS: reopened synthetic case " + saved["cm_name"]!.GetValue<string>());
  }
  var clientCountAfter = (await Api("GET", $"{sets["client"]}?$select=cm_clientid&$count=true"))!["@odata.count"]!.GetValue<int>();
  if (clientCountBefore != clientCountAfter) throw new Exception("Client count changed during case creation.");
  Console.WriteLine("PASS: two cases reuse one client; no client was created.");
  var history = await Api("GET", $"audits?$select=action,operation,createdon,_userid_value&$filter=_objectid_value eq {fullId}");
  var entries = history!["value"]!.AsArray();
  var complete = entries.Any(x => x!["operation"]!.GetValue<int>() == 1) && entries.Any(x => x!["operation"]!.GetValue<int>() == 2) && entries.All(x => x!["createdon"] != null && x["_userid_value"] != null);
  Console.WriteLine(complete ? "PASS: create/update audit entries contain actor and timestamp." : "PENDING: audit create/update entries not yet both visible; rerun smoke to recheck without changing fixtures.");
}
async Task SeedReview() {
  var sets = new Dictionary<string, string>();
  foreach (var key in review!.Rows.Select(r => r.Table).Distinct()) sets[key] = await EntitySet(key);
  // Two passes handle cycles without guessing or replacing stable record IDs.
  foreach (var row in review.Rows) {
    var table = tables.Single(t => t.Key == row.Table);
    var body = new JsonObject { [table.Name + "id"] = row.Id, ["cm_name"] = row.Label };
    foreach (var field in table.Fields.Where(f => f.Type != "lookup"))
      body["cm_" + field.Key] = row.Values[field.Key]?.DeepClone();
    var existing = await Api("GET", $"{sets[row.Table]}({row.Id})?$select={table.Name}id", missing: true);
    if (existing == null) await Api("POST", sets[row.Table], body);
    else { body.Remove(table.Name + "id"); await Api("PATCH", $"{sets[row.Table]}({row.Id})", body); }
  }
  foreach (var row in review.Rows) {
    var table = tables.Single(t => t.Key == row.Table);
    var body = new JsonObject();
    foreach (var field in table.Fields.Where(f => f.Type == "lookup"))
      if (row.Values.TryGetPropertyValue(field.Key, out var value) && value != null)
        body["cm_" + field.Key + "@odata.bind"] = $"/{sets[field.Target!]}({value.GetValue<string>()})";
      else body["cm_" + field.Key] = null;
    if (body.Count > 0) await Api("PATCH", $"{sets[row.Table]}({row.Id})", body);
    if (row.Table == "case_assignment")
      await Api("PATCH", $"{sets[row.Table]}({row.Id})", new { statecode = row.NativeInactive ? 1 : 0, statuscode = row.NativeInactive ? 2 : 1 });
  }
  Console.WriteLine($"Seeded {review.Rows.Length} synthetic records with canonical stable IDs.");
}
async Task VerifyReview() {
  var sets = new Dictionary<string, string>();
  foreach (var key in review!.Rows.Select(r => r.Table).Distinct()) sets[key] = await EntitySet(key);
  foreach (var row in review.Rows) {
    var table = tables.Single(t => t.Key == row.Table);
    var saved = (await Api("GET", $"{sets[row.Table]}({row.Id})"))!;
    if (row.Table == "case_assignment" && saved["statecode"]!.GetValue<int>() != (row.NativeInactive ? 1 : 0))
      throw new Exception("Synthetic assignment native state differs from its interval projection.");
    foreach (var field in table.Fields) {
      var actual = saved[field.Type == "lookup" ? "_cm_" + field.Key + "_value" : "cm_" + field.Key];
      var expected = row.Values[field.Key];
      var equal = JsonNode.DeepEquals(actual, expected);
      if (actual != null && expected != null) {
        if (field.Type == "date") equal = actual.GetValue<string>()[..10] == expected.GetValue<string>()[..10];
        if (field.Type == "datetime") equal = DateTimeOffset.Parse(actual.GetValue<string>()) == DateTimeOffset.Parse(expected.GetValue<string>());
        if (field.Type == "decimal") equal = actual.GetValue<decimal>() == expected.GetValue<decimal>();
      }
      if (!equal) throw new Exception($"Fixture mismatch: {table.Key}.{field.Key} on {row.Id}");
    }
  }
  Console.WriteLine($"PASS: reread all fields and relationships for {review.Rows.Length} synthetic records; runtime workflow enforcement is not claimed.");
}
static JsonObject Label(string text) => new() { ["LocalizedLabels"] = new JsonArray(new JsonObject { ["Label"] = text, ["LanguageCode"] = 1033 }) };
static JsonObject Attribute(Field f) {
  var type = f.Type switch { "date" or "datetime" => "DateTime", "memo" => "Memo", "integer" => "Integer", "decimal" => "Decimal", "bool" => "Boolean", "lookup" => "Lookup", _ => "String" };
  var result = new JsonObject {
    ["@odata.type"] = $"Microsoft.Dynamics.CRM.{type}AttributeMetadata", ["SchemaName"] = "cm_" + f.Key,
    ["DisplayName"] = Label(f.Label), ["RequiredLevel"] = new JsonObject { ["Value"] = f.Required ? "ApplicationRequired" : "None" },
    ["IsAuditEnabled"] = new JsonObject { ["Value"] = true }
  };
  if (f.Type == "text") { result["MaxLength"] = 200; result["FormatName"] = new JsonObject { ["Value"] = "Text" }; }
  if (f.Type == "memo") { result["MaxLength"] = 1048576; result["Format"] = "TextArea"; }
  if (f.Type == "integer") { result["MinValue"] = 0; result["MaxValue"] = 2147483647; result["Format"] = "None"; }
  if (f.Type == "decimal") { result["MinValue"] = 0; result["MaxValue"] = 100000000000; result["Precision"] = 4; }
  if (f.Type == "datetime") { result["Format"] = "DateAndTime"; result["DateTimeBehavior"] = new JsonObject { ["Value"] = "UserLocal" }; }
  if (f.Type == "date") { result["Format"] = "DateOnly"; result["DateTimeBehavior"] = new JsonObject { ["Value"] = "DateOnly" }; }
  if (f.Type == "bool") {
    result["DefaultValue"] = true;
    result["OptionSet"] = new JsonObject {
      ["TrueOption"] = new JsonObject { ["Value"] = 1, ["Label"] = Label("Yes") },
      ["FalseOption"] = new JsonObject { ["Value"] = 0, ["Label"] = Label("No") }
    };
  }
  return result;
}
static string Form(Table table, bool reviewMode = false) {
  var fields = new[] { new Field("name", table.Key == "case" ? "Case number" : "Display name", "text") }
    .Concat(table.Fields.Where(f => reviewMode || table.Key != "case" || f.Key != "closed_on"));
  var rows = fields.Select(f => new XElement("row", new XElement("cell", new XAttribute("id", Guid.NewGuid().ToString("B")),
    new XElement("labels", new XElement("label", new XAttribute("description", f.Label), new XAttribute("languagecode", "1033"))),
    new XElement("control", new XAttribute("id", "cm_" + f.Key), new XAttribute("datafieldname", "cm_" + f.Key),
      new XAttribute("classid", f.Type switch { "lookup" => "{270BD3DB-D9AF-4782-9025-509E298DEC0A}", "date" or "datetime" => "{5B773807-9FB2-42DB-97C3-7A91EFF8ADFF}", "memo" => "{E0DECE4B-6FC8-4A8F-A065-082708572369}", "integer" => "{C6D124CA-7EDA-4A60-AEA9-7FB8D318B68F}", "decimal" => "{C3EFE0C3-0EC6-42BE-8349-CBD9079C5A6F}", "bool" => "{67FAC785-CD58-4F9F-ABB3-4B7DDC6ED5ED}", _ => "{4273EDBD-AC1D-40D3-9FB2-095C621B552D}" }),
      new XAttribute("disabled", (reviewMode || table.Key == "case" && f.Key == "name") ? "true" : "false")))));
  return new XElement("form", new XElement("tabs", new XElement("tab", new XAttribute("name", "intake"), new XAttribute("id", Guid.NewGuid().ToString("B")), new XAttribute("IsUserDefined", "1"),
    new XElement("labels", new XElement("label", new XAttribute("description", reviewMode ? "Synthetic data review (read only)" : table.Key == "case" ? "Case intake" : "Details"), new XAttribute("languagecode", "1033"))),
    new XElement("columns", new XElement("column", new XAttribute("width", "100%"), new XElement("sections", new XElement("section", new XAttribute("name", "details"), new XAttribute("id", Guid.NewGuid().ToString("B")), new XAttribute("showlabel", "false"), new XAttribute("showbar", "false"), new XAttribute("columns", "1"),
      new XElement("labels", new XElement("label", new XAttribute("description", "Details"), new XAttribute("languagecode", "1033"))), new XElement("rows", rows)))))))).ToString();
}
record Field(string Key, string Label, string Type, bool Required = false, string? Target = null);
record Table(string Key, string Label, string Plural, bool Owned, Field[] Fields) { public string Name => "cm_" + Key; }

record ReviewPackage(string SpecVersion, Table[] Tables, ReviewRow[] Rows);
record ReviewRow(string Table, string Id, string Label, JsonObject Values, bool NativeInactive = false);
static class ReviewChecks {
  public static void Validate(ReviewPackage package) {
    var tables = package.Tables.ToDictionary(t => t.Key);
    var rows = package.Rows.ToDictionary(r => (r.Table, r.Id));
    foreach (var table in package.Tables) {
      if (!System.Text.RegularExpressions.Regex.IsMatch(table.Key, "^[a-z][a-z0-9_]*$")) throw new Exception("Invalid table key.");
      foreach (var field in table.Fields) {
        if (field.Type == "lookup" && !tables.ContainsKey(field.Target!)) throw new Exception("Unknown lookup target.");
      }
    }
    foreach (var row in package.Rows) {
      _ = Guid.Parse(row.Id);
      var fields = tables[row.Table].Fields.ToDictionary(f => f.Key);
      foreach (var pair in row.Values) {
        var field = fields[pair.Key];
        if (field.Type == "lookup" && pair.Value != null && !rows.ContainsKey((field.Target!, pair.Value.GetValue<string>())))
          throw new Exception("Synthetic lookup does not resolve.");
      }
    }
  }
}
