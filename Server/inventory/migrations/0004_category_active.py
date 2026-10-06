from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [('inventory', '0003_assigned_cabinet_bounds')]
    operations = [migrations.AddField(model_name='category', name='is_active', field=models.BooleanField(default=True))]
