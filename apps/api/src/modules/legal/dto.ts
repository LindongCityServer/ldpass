import { IsString, Length } from 'class-validator';

export class UpdateLegalDocumentDto {
  @IsString()
  @Length(2, 120)
  title!: string;

  @IsString()
  @Length(20, 20000)
  content!: string;
}
