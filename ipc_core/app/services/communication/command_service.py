from ipc_core.app.serial import serial_manager

from ipc_core.app.serial.protocol.builder import ProtocolBuilder


class CommandService:

    def send_open_rack(
        self,
        rack_id: int
    ):

        self.send_command("OPEN_RACK", rack_id)

    def send_close_rack(
        self,
        rack_id: int
    ):

        self.send_command("CLOSE_RACK", rack_id)

    def send_ventilate_rack(
        self,
        rack_id: int
    ):

        self.send_command("VENTILATE_RACK", rack_id)

    def send_command(self, command: str, rack_id: int):

        msg = ProtocolBuilder.build(
            "command",
            {
                "command": command,
                "rack": rack_id
            }
        )

        serial_manager.send(msg)