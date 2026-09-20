class AckHandler:

    async def handle(self, payload):

        print("ACK:", payload)
        
        values = payload.get("values", [])
        if values:
            print(f"[ACK] Received acknowledgment with values: {values}")