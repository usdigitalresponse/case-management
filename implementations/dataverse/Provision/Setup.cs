using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

static class Setup
{
  internal record Result(int ExitCode, string? EnvironmentName = null, bool Exists = false);

  internal static string NormalizeUrl(string input)
  {
    if (!Uri.TryCreate(input.Trim(), UriKind.Absolute, out var uri) ||
        uri.Scheme != "https" || uri.Port != 443 || uri.UserInfo.Length != 0 ||
        uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
        !Regex.IsMatch(uri.Host, @"^[a-z0-9-]+\.(api\.)?crm[0-9]*\.dynamics\.com$", RegexOptions.IgnoreCase) ||
        !Regex.IsMatch(uri.AbsolutePath, @"^/(api/data/v[0-9]+\.[0-9]+/?)?$"))
      throw new ArgumentException("Paste the environment URL or Web API endpoint, not the maker portal link or an ID. This prototype supports commercial-cloud Dataverse URLs ending in crm[number].dynamics.com.");
    return "https://" + uri.Host.Replace(".api.", ".", StringComparison.OrdinalIgnoreCase);
  }

  public static async Task<int> Run(TextReader input, TextWriter output,
    Func<string, string, string?, Task<Result>>? execute = null)
  {
    execute ??= Execute;
    output.WriteLine("\nCase Intake Prototype — guided setup\n");
    output.WriteLine("This sets up five tables, sample records, and a New case form in an existing development environment.");
    output.WriteLine("You need a Dataverse database with English as its base language and an account allowed to customize it.");
    output.WriteLine("Your environment address is used for this run only. No configuration or passwords are saved in this repository.\n");
    output.WriteLine("Find your environment information:");
    output.WriteLine("  1. Open https://make.powerapps.com/ and sign in.");
    output.WriteLine("  2. Select your DEVELOPMENT environment in the top-right environment selector.");
    output.WriteLine("  3. Select the Settings gear, then Developer resources.");
    output.WriteLine("  4. Copy the Web API endpoint. It starts with https:// and ends with /api/data/v9.2 (or a similar version).");
    output.WriteLine("     You do not need the Environment ID or Organization ID.");
    output.WriteLine("Alternative: in https://admin.powerplatform.microsoft.com/ open Manage → Environments,");
    output.WriteLine("select the environment, and copy its Environment URL from the details.");
    output.WriteLine("If you cannot see these settings or there is no database, ask your Power Platform administrator to help.\n");
    string url;
    while (true)
    {
      output.Write("Paste the URL (or press Enter to cancel): ");
      var value = input.ReadLine();
      if (string.IsNullOrWhiteSpace(value)) return 0;
      try { url = NormalizeUrl(value); break; }
      catch (ArgumentException e) { output.WriteLine(e.Message); }
    }
    output.WriteLine($"\nEnvironment address: {url}");
    output.WriteLine("Most prototype users can use Microsoft's development sign-in application.");
    output.WriteLine("If your administrator gave you a custom Application (client) ID, enter it below.");
    output.WriteLine("They can find it in https://entra.microsoft.com/ → Entra ID → App registrations → the app → Overview.");
    output.WriteLine("Use Application (client) ID, not Object ID. The app must support public-client device sign-in and Dataverse delegated access.");
    string? clientId;
    while (true)
    {
      output.Write("Application (client) ID [Enter = Microsoft development default]: ");
      clientId = input.ReadLine();
      if (clientId == null) return 0;
      clientId = clientId.Trim();
      if (clientId.Length == 0) { clientId = null; break; }
      if (Guid.TryParseExact(clientId, "D", out _)) break;
      output.WriteLine("That is not an application ID. Enter the ID in the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx, or leave it blank.");
    }
    output.WriteLine("\nChecking the connection. If Microsoft prints a sign-in link and code, open the link and enter the code.");
    output.WriteLine("Sign in with the account for this development environment and complete MFA. Do not enter your password here.");
    output.WriteLine("Microsoft may label the default application 'Dynamics 365 Example Client Application'.");
    var inspected = await execute("setup-inspect", url, clientId);
    if (inspected.ExitCode != 0 || string.IsNullOrWhiteSpace(inspected.EnvironmentName))
    {
      output.WriteLine("\nSetup stopped before deployment. Check the sign-in/account, database, language, and customization permissions shown above.");
      output.WriteLine("If Microsoft requests administrator consent, ask your administrator; setup cannot grant it.");
      return 1;
    }
    output.WriteLine($"\nConnected environment: {inspected.EnvironmentName}\nAddress: {url}");
    if (inspected.Exists)
    {
      output.WriteLine("The prototype already exists. Press Enter to verify it without changing it.");
      output.WriteLine("Type REBUILD only to resume or deliberately rebuild this prototype. Rebuilding replaces its main form layouts.");
    }
    else output.WriteLine("The prototype is not installed here yet.");
    output.WriteLine("Setup creates sample data and publishes the app. It enables environment auditing, including other tables already marked for auditing.");
    output.WriteLine("It does not grant security roles. Use synthetic data only. Confirm that this is the intended DEVELOPMENT environment.");
    output.Write(inspected.Exists ? "Enter = verify, REBUILD = deploy, anything else = cancel: " : "Type SET UP to deploy, or press Enter to cancel: ");
    var action = input.ReadLine();
    if (action == null) return 0;
    var deploy = action.Trim() == (inspected.Exists ? "REBUILD" : "SET UP");
    if (!deploy && !(inspected.Exists && action.Trim().Length == 0))
    {
      output.WriteLine("Cancelled. No deployment changes made.");
      return 0;
    }
    var result = await execute(deploy ? "deploy" : "verify", url, clientId);
    if (result.ExitCode != 0)
    {
      output.WriteLine("\nThe operation did not finish. Deployment can leave partially created components.");
      output.WriteLine("Keep the error above for troubleshooting. Check the target before rerunning; REBUILD replaces form layouts.");
      return 1;
    }
    output.WriteLine("\nFinished. Open the App link above, or select this environment in Power Apps and open Apps → Case Intake Prototype.");
    output.WriteLine("Choose Cases → New, select a synthetic client and Sample Intake status, then save.");
    output.WriteLine("Automated metadata checks do not replace trying the form and checking access. See docs/deployment.md for limitations.");
    return 0;
  }

  static async Task<Result> Execute(string mode, string url, string? clientId)
  {
    var executable = Environment.ProcessPath ?? throw new Exception("Cannot locate the running .NET executable.");
    var processInfo = new ProcessStartInfo(executable) {
      UseShellExecute = false, RedirectStandardOutput = true
    };
    if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
      processInfo.ArgumentList.Add(typeof(Setup).Assembly.Location);
    processInfo.ArgumentList.Add(mode);
    processInfo.ArgumentList.Add(url);
    // The wizard's explicit choice takes precedence over an inherited shell value.
    processInfo.Environment.Remove("DATAVERSE_CLIENT_ID");
    if (clientId != null) processInfo.Environment["DATAVERSE_CLIENT_ID"] = clientId;
    using var process = Process.Start(processInfo) ?? throw new Exception("Could not start the provisioning tool.");
    Result result = new(1);
    while (await process.StandardOutput.ReadLineAsync() is { } line)
    {
      if (line.StartsWith("SETUP_RESULT:"))
        result = JsonSerializer.Deserialize<Result>(line["SETUP_RESULT:".Length..]) ?? new(1);
      else Console.WriteLine(line);
    }
    await process.WaitForExitAsync();
    return result with { ExitCode = process.ExitCode };
  }
}
