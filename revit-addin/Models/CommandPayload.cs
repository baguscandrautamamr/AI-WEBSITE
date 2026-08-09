using System.Collections.Generic;

namespace ElectricalAddin.Models
{
    public class CommandPayload
    {
        public string Id { get; set; } = "";
        public string DeviceId { get; set; } = "";
        public string Type { get; set; } = "";
        public Dictionary<string, object> Payload { get; set; } = new();
        public string Status { get; set; } = "pending";
    }
}
