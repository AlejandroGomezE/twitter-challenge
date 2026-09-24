import { Controller, Get, SerializeOptions } from '@nestjs/common';
import { AppService } from './app.service.js';
import { MessageResponseDto } from './common/dto/message-response.dto.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @SerializeOptions({ type: MessageResponseDto })
  getHello(): MessageResponseDto {
    return this.appService.getHello();
  }
}
