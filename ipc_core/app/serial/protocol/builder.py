import json


class ProtocolBuilder:

    @staticmethod
    def build(
        msg_type: str,
        payload: dict
    ) -> str:

        if msg_type == "command":
            command = payload.get("command")
            rack = payload.get("rack")
            if rack is not None and command is not None:
                action_map = {
                    "OPEN_RACK": "1",
                    "CLOSE_RACK": "2",
                    "LIGHT_RACK": "0",
                    "VENTILATE_RACK": "3"
                }
                action = action_map.get(command)
                if action is not None:
                    return f"0|{rack}|{action}"

        data = {
            "type": msg_type,
            **payload
        }

        return json.dumps(data)