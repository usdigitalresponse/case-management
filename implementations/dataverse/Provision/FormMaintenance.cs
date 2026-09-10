using System.Xml.Linq;

static class FormMaintenance
{
  // Preserve maker layout, events, controls and IDs. New fields get their own tab.
  internal static string AddMissingFields(string existing, string generated)
  {
    var original = XDocument.Parse(existing);
    var template = XDocument.Parse(generated);
    var present = original.Descendants("control").Select(c => (string?)c.Attribute("datafieldname")).ToHashSet();
    foreach (var row in template.Descendants("row").ToArray())
      if (row.Descendants("control").All(c => present.Contains((string?)c.Attribute("datafieldname")))) row.Remove();
    if (!template.Descendants("control").Any()) return existing;
    var tab = template.Descendants("tab").Single();
    tab.SetAttributeValue("name", "schema_additions_" + Guid.NewGuid().ToString("N"));
    foreach (var label in tab.Element("labels")!.Elements("label")) label.SetAttributeValue("description", "Additional schema fields");
    original.Root!.Element("tabs")!.Add(tab);
    return original.ToString();
  }
}
