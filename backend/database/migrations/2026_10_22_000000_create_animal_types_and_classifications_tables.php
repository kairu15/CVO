<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The CVO's two-level animal master list: Animal Type → Classification.
     *
     * Both tables are seeded HERE, in the migration, rather than only in a
     * seeder: every migrated database (including the in-memory SQLite the test
     * suite builds) needs the vocabulary before it can store an animal. The
     * seed is idempotent (`updateOrInsert`), so re-running the migration on a
     * database an administrator has already edited only adds missing rows and
     * never overwrites a rename or a custom classification.
     *
     * `main_category` stays a plain string rather than a database enum: MySQL
     * enforces enums but SQLite (the test database) does not, and adding a
     * fourth category must not become a schema migration. The allowed values
     * are validated in the request classes.
     */
    public function up(): void
    {
        Schema::create('animal_types', function (Blueprint $table): void {
            $table->id();
            $table->string('main_category', 32)->index();
            $table->string('name')->unique();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('animal_classifications', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('animal_type_id')->constrained('animal_types')->cascadeOnDelete();
            $table->string('name');
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            // "Boar" exists under more than one type (Swine, Guinea pig), so
            // uniqueness is per type, never across the whole table.
            $table->unique(['animal_type_id', 'name']);
            $table->index(['animal_type_id', 'sort_order']);
        });

        $this->seedMasterList();
    }

    public function down(): void
    {
        Schema::dropIfExists('animal_classifications');
        Schema::dropIfExists('animal_types');
    }

    /**
     * The complete list supplied by the CVO, exactly as given — no merging,
     * no abbreviation. Order within a category is the order it was supplied
     * in, and classifications keep their own order under each type.
     */
    private function seedMasterList(): void
    {
        $catalogue = [
            'livestock' => [
                'Swine (Pig)' => ['Boar', 'Sow', 'Gilt', 'Barrow', 'Piglet', 'Feeder pig'],
                'Cattle' => ['Bull', 'Cow', 'Heifer', 'Steer', 'Calf'],
                'Carabao (Water Buffalo)' => ['Bull buffalo', 'Cow buffalo', 'Heifer buffalo', 'Calf', 'Castrated male'],
                'Goat' => ['Buck', 'Doe', 'Wether', 'Kid'],
                'Sheep' => ['Ram', 'Ewe', 'Wether', 'Lamb'],
                'Horse' => ['Stallion', 'Mare', 'Gelding', 'Foal'],
                'Donkey' => ['Jack', 'Jenny', 'Gelding', 'Foal'],
                'Mule' => ['Male mule', 'Female mule', 'Young mule'],
                'Rabbit' => ['Buck', 'Doe', 'Kit'],
                'Deer' => ['Stag', 'Hind', 'Fawn'],
                'Water buffalo (other breeds)' => ['Bull', 'Cow', 'Heifer', 'Calf'],
                'Alpaca' => ['Male', 'Female', 'Cria'],
                'Llama' => ['Male', 'Female', 'Cria'],
                'Camel' => ['Bull', 'Cow', 'Calf'],
                'Guinea pig' => ['Boar', 'Sow', 'Pup'],
            ],
            'poultry' => [
                'Chicken' => ['Rooster', 'Hen', 'Cockerel', 'Pullet', 'Chick', 'Broiler', 'Layer', 'Breeder'],
                'Duck' => ['Drake', 'Duck/Hen', 'Duckling', 'Breeder duck'],
                'Muscovy Duck' => ['Drake', 'Duck/Hen', 'Duckling'],
                'Quail' => ['Male', 'Female', 'Chick', 'Breeder quail'],
                'Turkey' => ['Tom', 'Hen', 'Poult'],
                'Goose' => ['Gander', 'Goose', 'Gosling'],
                'Guinea Fowl' => ['Male', 'Female', 'Keet'],
                'Pigeon' => ['Cock', 'Hen', 'Squab'],
                'Pheasant' => ['Cock', 'Hen', 'Chick'],
                'Peafowl' => ['Peacock', 'Peahen', 'Peachick'],
                'Ostrich' => ['Cock', 'Hen', 'Chick'],
                'Emu' => ['Male', 'Female', 'Chick'],
                'Partridge' => ['Male', 'Female', 'Chick'],
                'Parrot (captive-bred)' => ['Male', 'Female', 'Chick'],
            ],
            'other' => [
                'Dog' => ['Male', 'Female', 'Puppy'],
                'Cat' => ['Male', 'Female', 'Kitten'],
                'Honeybee' => ['Queen', 'Drone', 'Worker'],
                'Fish' => ['Fry', 'Fingerling', 'Juvenile', 'Adult'],
                'Tilapia' => ['Male', 'Female', 'Fry', 'Fingerling'],
                'Catfish' => ['Male', 'Female', 'Fry', 'Fingerling'],
            ],
        ];

        $now = now();

        foreach ($catalogue as $category => $types) {
            $typeOrder = 0;

            foreach ($types as $typeName => $classifications) {
                $typeOrder++;

                // Existing rows are left alone: an admin who renamed a type or
                // added one keeps that edit when the migration is replayed.
                $existing = DB::table('animal_types')->where('name', $typeName)->value('id');

                if ($existing === null) {
                    $typeId = DB::table('animal_types')->insertGetId([
                        'main_category' => $category,
                        'name' => $typeName,
                        'sort_order' => $typeOrder,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                } else {
                    $typeId = $existing;
                }

                $classificationOrder = 0;

                foreach ($classifications as $classification) {
                    $classificationOrder++;

                    DB::table('animal_classifications')->updateOrInsert(
                        ['animal_type_id' => $typeId, 'name' => $classification],
                        ['sort_order' => $classificationOrder, 'updated_at' => $now, 'created_at' => $now],
                    );
                }
            }
        }
    }
};
