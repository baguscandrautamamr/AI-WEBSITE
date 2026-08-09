using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using ElectricalAddin.Bridge;

namespace ElectricalAddin.App
{
    public class Application : IExternalApplication
    {
        public static CommandPoller? Poller;

        public Result OnStartup(UIControlledApplication app)
        {
            RibbonPanel panel = app.CreateRibbonPanel("Electrical AI");

            var buttonData = new PushButtonData(
                "OpenElectricalAI",
                "Electrical AI",
                System.Reflection.Assembly.GetExecutingAssembly().Location,
                "ElectricalAddin.App.ShowPanelCommand");
            panel.AddItem(buttonData);

            // Command poller mulai jalan sejak add-in dimuat (background thread)
            Poller = new CommandPoller();
            Poller.Start(app);

            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication app)
        {
            Poller?.Stop();
            return Result.Succeeded;
        }
    }

    [Transaction(TransactionMode.Manual)]
    public class ShowPanelCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, Autodesk.Revit.DB.ElementSet elements)
        {
            DockablePanelUI.ShowOrFocus();
            return Result.Succeeded;
        }
    }
}
